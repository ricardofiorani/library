export function compile(input: string) {
  return input.split('\n').map((line) => parse(line));
}

export const POOL_SIZE = 64;

export interface Command {
  name: string;
  arguments: number[];
}

export interface CNodesSwitchedOnOrOff {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  isOff: boolean;
  isCars: boolean;
}

function parse(input: string): Command | undefined {
  let trimmed = input.trim().toLowerCase();

  let buf = '';
  let inComment = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '{') {
      inComment = true;
    } else if (char === '}') {
      inComment = false;
    } else if (!inComment) {
      if (char === '/' && trimmed[i + 1] === '/') {
        break;
      }
      buf += char;
    }
  }

  if (buf.length === 0) {
    return;
  }

  let command = {} as Command;

  const commandMap = {
    '01e7:': 'switch_roads_on',
    '01e8:': 'switch_roads_off',
    '091d:': 'switch_roads_back_to_original',
    '091e:': 'switch_ped_roads_back_to_original',
    '022a:': 'switch_ped_roads_on',
    '022b:': 'switch_ped_roads_off',
    switch_roads_on: 'switch_roads_on',
    switch_roads_off: 'switch_roads_off',
    switch_roads_back_to_original: 'switch_roads_back_to_original',
    switch_ped_roads_back_to_original: 'switch_ped_roads_back_to_original',
    switch_ped_roads_on: 'switch_ped_roads_on',
    switch_ped_roads_off: 'switch_ped_roads_off',
    mission_has_finished: 'mission_has_finished',
    '00d8': 'mission_has_finished',
  };

  for (const [id, name] of Object.entries(commandMap)) {
    let [res, next] = strTok(buf, id);
    if (res) {
      command.name = name;
      buf = next.trim();
      break;
    }
  }

  const args = buf.split(/\s+/);
  command.arguments = args
    .map((arg) => {
      const num = parseFloat(arg);
      if (isNaN(num)) {
        return null;
      }
      return num;
    })
    .filter((arg) => arg !== null);

  return command;
}

function strTok(s: string, tok: string): [boolean, string] {
  if (s.startsWith(tok)) {
    return [true, s.substring(tok.length).trim()];
  }
  return [false, s];
}

export function execute(
  commands: Array<Command | undefined>,
  options: { patched: boolean; improved: boolean },
  pool: CNodesSwitchedOnOrOff[]
) {
  for (const cmd of commands) {
    if (!cmd) {
      continue;
    }
    console.log(
      `Executing command: ${cmd.name} with arguments: ${cmd.arguments.join(
        ', '
      )}`
    );
    const [xA, yA, zA] = cmd.arguments.slice(0, 3);
    const [xB, yB, zB] = cmd.arguments.slice(3, 6);
    const xMin = Math.min(xA, xB);
    const xMax = Math.max(xA, xB);
    const yMin = Math.min(yA, yB);
    const yMax = Math.max(yA, yB);
    const zMin = Math.min(zA, zB);
    const zMax = Math.max(zA, zB);
    switch (cmd.name) {
      case 'mission_has_finished': {
        pool.splice(54);
        break;
      }
      case 'switch_roads_on':
        SwitchRoadsOffInArea(
          pool,
          options,
          xMin,
          xMax,
          yMin,
          yMax,
          zMin,
          zMax,
          false,
          true,
          false
        );
        break;
      case 'switch_roads_off':
        SwitchRoadsOffInArea(
          pool,
          options,
          xMin,
          xMax,
          yMin,
          yMax,
          zMin,
          zMax,
          true,
          true,
          false
        );
        break;
      case 'switch_roads_back_to_original':
        SwitchRoadsOffInArea(
          pool,
          options,
          xMin,
          xMax,
          yMin,
          yMax,
          zMin,
          zMax,
          false,
          true,
          true
        );
        break;
      case 'switch_ped_roads_on':
        SwitchRoadsOffInArea(
          pool,
          options,
          xMin,
          xMax,
          yMin,
          yMax,
          zMin,
          zMax,
          false,
          false,
          false
        );
        break;
      case 'switch_ped_roads_off':
        SwitchRoadsOffInArea(
          pool,
          options,
          xMin,
          xMax,
          yMin,
          yMax,
          zMin,
          zMax,
          true,
          false,
          false
        );
        break;
      case 'switch_ped_roads_back_to_original':
        SwitchRoadsOffInArea(
          pool,
          options,
          xMin,
          xMax,
          yMin,
          yMax,
          zMin,
          zMax,
          false,
          false,
          true
        );
        break;
    }
  }
}

function SwitchRoadsOffInArea(
  pool: CNodesSwitchedOnOrOff[],
  options: { patched: boolean; improved: boolean },
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number,
  bSwitchOff: boolean,
  bCars: boolean,
  bBackToOriginal: boolean
) {
  for (let i = 0; i < pool.length; i++) {
    const area = pool[i];
    // If the existing area is completely inside the area we are switching off, remove it
    if (
      area.xMin < xMin ||
      area.yMin < yMin ||
      area.zMin < zMin ||
      area.xMax > xMax ||
      area.yMax > yMax ||
      area.zMax > zMax
    ) {
      continue;
    }

    // store cars and peds zones separately
    if (options.improved && area.isCars !== bCars) {
      continue;
    }

    // toggling areas of the same size acts like BACK_TO_ORIGINAL and new area is not saved
    if (
      options.improved &&
      area.xMin === xMin &&
      area.xMax === xMax &&
      area.yMin === yMin &&
      area.yMax === yMax &&
      area.zMin === zMin &&
      area.zMax === zMax &&
      area.isOff !== bSwitchOff
    ) {
      bBackToOriginal = true;
    }

    // Remove the area from the pool

    for (let j = i; j < pool.length - 1; j++) {
      // Shift the area to the left
      if (options.patched) {
        pool[j] = pool[j + 1];
      } else {
        // R* bug, they messed up with the index
        pool[i] = pool[i + 1];
      }
    }

    pool.pop(); // Remove the last element, which is now a duplicate

    i--;
  }

  if (!bBackToOriginal && pool.length < POOL_SIZE) {
    pool.push({
      xMin,
      xMax,
      yMin,
      yMax,
      zMin,
      zMax,
      isOff: bSwitchOff,
      isCars: bCars,
    });
  }
}
