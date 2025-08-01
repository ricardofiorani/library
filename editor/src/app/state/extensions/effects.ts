import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of, zip } from 'rxjs';
import { Router } from '@angular/router';
import {
  tap,
  switchMap,
  withLatestFrom,
  concatMap,
  map,
  take,
  distinctUntilChanged,
  catchError,
} from 'rxjs/operators';
import { flatMap, groupBy, flatten } from 'lodash';

import {
  cloneCommand,
  GameCommandUpdate,
  init,
  initSupportInfo,
  loadExtensions,
  loadExtensionsError,
  loadExtensionsSuccess,
  loadSupportInfo,
  loadSupportInfoError,
  updateCommands,
  updateGameCommands,
} from './actions';
import { ExtensionsService } from './service';
import { ExtensionsFacade } from './facade';
import { ChangesFacade } from '../changes/facade';
import {
  Command,
  Game,
  GameLibrary,
  GameNativeLibrary,
  GameNativeVersion,
  GamePlatforms,
  GameVersion,
  GameVersions,
  PrimitiveType,
  ViewContext,
} from '../../models';
import {
  commandParams,
  getSameCommands,
  doesCommandHaveAnyAttributeInvalid,
  replaceType,
  isOtherGame,
} from '../../utils';
import { AuthFacade } from '../auth/facade';
import { GameFacade } from '../game/facade';
import { renameGameEnum } from '../enums/actions';
import { registerFileContent } from '../changes/actions';
import { Action } from '@ngrx/store';
import { unpackSupportInfo } from 'src/app/utils/support-info';

@Injectable({ providedIn: 'root' })
export class ExtensionsEffects {
  extensions$ = createEffect(() =>
    this._game.game$.pipe(
      distinctUntilChanged(),
      map((game) => loadExtensions({ game }))
    )
  );

  viewContexts$ = createEffect(() =>
    this._game.viewContext$.pipe(
      distinctUntilChanged(),
      withLatestFrom(this._game.game$),
      map(([_, game]) => loadExtensions({ game }))
    )
  );

  loadExtensions$ = createEffect(() =>
    this._actions$.pipe(
      ofType(loadExtensions),
      withLatestFrom(this._game.viewContext$),
      distinctUntilChanged(
        ([a, ea], [b, eb]) =>
          GameLibrary[a.game] === GameLibrary[b.game] && ea === eb
      ),
      withLatestFrom(this._auth.authToken$, this._auth.isAuthorized$),
      concatMap(([[{ game }, viewContext], accessToken, isAuthorized]) =>
        this._service.loadExtensions(game, viewContext, accessToken).pipe(
          switchMap((response) => {
            const actions: Action[] = [
              loadExtensionsSuccess({
                game,
                viewContext,
                extensions: response.extensions,
                lastUpdate: response.meta.last_update,
                version: response.meta.version,
                classes: response.classes,
              }),
            ];

            if (isAuthorized) {
              actions.push(
                registerFileContent({
                  fileName: GameLibrary[game],
                  lastUpdate: response.meta.last_update,
                  content: JSON.stringify(response, null, 2),
                })
              );
            }

            return actions;
          }),
          catchError(() => of(loadExtensionsError({ game })))
        )
      )
    )
  );

  updateCommands$ = createEffect(() =>
    this._actions$.pipe(
      ofType(updateCommands),
      withLatestFrom(this._game.game$),
      switchMap(([{ batch, updateRelated }, game]) => {
        return zip(
          ...batch.map(({ command, extension, shouldDelete }) => {
            // find copies of this command in other games to propagate the changes

            return this._extensions
              .getCommandSupportInfo(command, extension)
              .pipe(
                withLatestFrom(
                  this._extensions.getExtensionCommand({
                    id: command.id || command.name,
                    extension,
                  })
                ),
                take(1),
                map(([supportInfo, oldCommand]) => {
                  if (
                    // delete command only from the current game
                    !shouldDelete &&
                    // Other games should not trigger cross game updates, nor should they be updated
                    !isOtherGame(game) &&
                    shouldUpdateOtherGames(command, oldCommand) &&
                    updateRelated
                  ) {
                    return getSameCommands(supportInfo, game)
                      .filter((d) => !isOtherGame(d.game))
                      .map((d) => ({
                        game: d.game,
                        command,
                        extension,
                        shouldDelete,
                        ignoreVersionAndPlatform: d.game !== game,
                      }));
                  } else {
                    return [
                      {
                        game,
                        command,
                        extension,
                        shouldDelete,
                        ignoreVersionAndPlatform: false,
                      },
                      // also update supportinfo for other games where this command is present
                      ...(shouldDelete
                        ? getSameCommands(supportInfo, game)
                            .filter((d) => d.game !== game)
                            .map((d) => ({ game: d.game }))
                        : []),
                    ];
                  }
                })
              );
          })
        );
      }),
      switchMap((updates) => {
        const groups = groupBy(flatten(updates), 'game');

        return [
          ...Object.entries(groups)
            .filter(([_, group]) => group.some((batch) => 'command' in batch))
            .map(([game, batch]) =>
              updateGameCommands({
                game: game as Game,
                batch: batch as GameCommandUpdate[],
              })
            ),
          ...Object.entries(groups).map(([game]) =>
            initSupportInfo({ game: game as Game })
          ),
        ];
      })
    )
  );

  updateGameCommands$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGameCommands),
        // distinctUntilChanged<ReturnType<typeof updateGameCommands>>(isEqual),
        switchMap(({ game }) =>
          this._extensions.getGameExtensions(game).pipe(
            withLatestFrom(
              this._extensions.getGameVersion(game),
              this._extensions.getGameClassesMeta(game),
              this._game.viewContext$
            ),
            tap(([extensions, oldVersion, classesMeta, viewContext]) => {
              const version = bumpVersion(oldVersion);
              this._changes.registerExtensionsChange({
                version,
                fileName:
                  viewContext === ViewContext.Code
                    ? GameNativeLibrary[game]
                    : GameLibrary[game],
                content: extensions,
                url: 'https://library.sannybuilder.com/#/' + game,
                classesMeta,
                game,
              });
              this._changes.registerTextFileChange(
                viewContext === ViewContext.Code
                  ? GameNativeVersion[game]
                  : GameVersion[game],
                version
              );
            })
          )
        )
      ),
    { dispatch: false }
  );

  renameEnum$ = createEffect(() =>
    this._actions$.pipe(
      ofType(renameGameEnum),
      switchMap(({ game, oldEnumName, newEnumName, isAffected }) =>
        this._extensions.getGameExtensions(game).pipe(
          // take(1),
          switchMap((extensions) => {
            const affectedCommands = flatMap(extensions, (extension) =>
              extension.commands
                .filter((c) =>
                  commandParams(c).some((p) => p.type === oldEnumName)
                )
                .map((c) => ({
                  extension: extension.name,
                  command: {
                    ...c,
                    input: replaceType(
                      c.input,
                      oldEnumName,
                      newEnumName || PrimitiveType.any
                    ),
                    output: replaceType(
                      c.output,
                      oldEnumName,
                      newEnumName || PrimitiveType.any
                    ),
                  },
                }))
            );
            if (isAffected) {
              return of({ affectedCommands, otherGames: [] });
            }
            return zip(
              ...affectedCommands.map(({ extension, command }) => {
                return this._extensions.getCommandSupportInfo(
                  command,
                  extension
                );
              })
            ).pipe(
              take(1),
              map((supportInfos) => {
                const otherGames = new Set<Game>();
                for (const info of supportInfos) {
                  const sameCommands = getSameCommands(info, game);
                  sameCommands.forEach((sameCommand) =>
                    otherGames.add(sameCommand.game)
                  );
                }
                otherGames.delete(game);
                return {
                  otherGames: [...otherGames],
                  affectedCommands,
                };
              })
            );
          }),
          switchMap(({ otherGames, affectedCommands }) => [
            updateGameCommands({
              game,
              batch: affectedCommands.map(({ extension, command }) => ({
                command,
                extension,
                shouldDelete: false,
                ignoreVersionAndPlatform: isAffected,
              })),
            }),
            ...otherGames.map((otherGame) =>
              renameGameEnum({
                game: otherGame,
                newEnumName,
                oldEnumName,
                isAffected: true,
              })
            ),
          ])
        )
      )
    )
  );

  validateExtensions$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(loadExtensionsSuccess),
        tap(({ extensions }) => {
          extensions.forEach((extension) =>
            extension.commands.forEach((command) => {
              if (doesCommandHaveAnyAttributeInvalid(command)) {
                console.warn(
                  `Invalid combination of attributes: extension ${extension.name}, command: ${command.name}`
                );
              }
            })
          );
        })
      ),
    { dispatch: false }
  );

  loadSupportInfo$ = createEffect(() =>
    this._actions$.pipe(
      ofType(init),
      switchMap(() =>
        this._service.loadSupportInfo().pipe(
          map((data) => loadSupportInfo({ data: unpackSupportInfo(data) })),
          catchError(() => of(loadSupportInfoError()))
        )
      )
    )
  );

  cloneCommand$ = createEffect(() =>
    this._actions$.pipe(
      ofType(cloneCommand),
      tap(({ game, command, extension }) => {
        this._router.navigate([
          '/',
          game,
          extension,
          command.id || command.name,
        ]);
      }),
      switchMap(({ game, command, extension }) => [
        updateGameCommands({
          game,
          batch: [
            {
              command: {
                ...command,
                platforms: GamePlatforms[game],
                versions: GameVersions[game],
              },
              extension,
              shouldDelete: false,
              ignoreVersionAndPlatform: false,
            },
          ],
        }),
        initSupportInfo({ game }),
      ])
    )
  );

  constructor(
    private _actions$: Actions,
    private _extensions: ExtensionsFacade,
    private _changes: ChangesFacade,
    private _auth: AuthFacade,
    private _service: ExtensionsService,
    private _game: GameFacade,
    private _router: Router
  ) {}
}

// if return false then only current game will be updated
function shouldUpdateOtherGames(
  command: Command,
  oldCommand?: Command
): boolean {
  if (!oldCommand) {
    return false;
  }

  if (command.name !== oldCommand.name) {
    return false;
  }
  if (command.num_params !== oldCommand.num_params) {
    return false;
  }

  const attrs = command.attrs || {};
  const oldAttrs = oldCommand.attrs || {};

  if (attrs.is_unsupported !== oldAttrs.is_unsupported) {
    return false;
  }
  if (attrs.is_nop !== oldAttrs.is_nop) {
    return false;
  }

  return true;
}

function bumpVersion(version?: string): string {
  if (!version) {
    return '0.1';
  }
  const [major, minor] = version.split('.');
  let newMinor = isNaN(+minor) ? 0 : +minor;
  let newMajor = isNaN(+major) ? 0 : +major;

  newMinor += 1;
  if (newMinor > 999) {
    newMinor = 0;
    newMajor += 1;
  }
  return [newMajor, newMinor].join('.');
}
