import {
  CdkDragDrop,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import {
  capitalizeFirst,
  doesEnumHaveDuplicateField,
  doesEnumHaveEmptyName,
  doesEnumHaveOneEmptyField,
  doesEnumNameConflict,
  doesEnumHaveInvalidFieldName,
  doesEnumHaveInvalidName,
  isEmptyEnum,
  isFieldNameDuplicate,
  isStringEnum,
} from '../../../utils';
import { EnumRaw, Game } from '../../../models';
import { trim } from 'lodash';

type ErrorType =
  | 'emptyEnumName'
  | 'emptyFieldName'
  | 'duplicateFieldName'
  | 'emptyEnum'
  | 'nameConflict'
  | 'invalidEnumName'
  | 'invalidEnumFieldName';

@Component({
    selector: 'scl-enum-editor',
    templateUrl: './enum-editor.component.html',
    styleUrls: ['./enum-editor.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class EnumEditorComponent {
  private _enumToEdit: EnumRaw;
  private _enumGames: Game[];
  cloneTargets: Array<{ name: string; value: Game }>;

  @Input() set enumToEdit(val: EnumRaw) {
    this._enumToEdit = val;
    this.updateErrors();
    this.isDirty = false;
  }

  get enumToEdit(): EnumRaw {
    return this._enumToEdit;
  }

  @Input() set enumGames(val: Game[]) {
    this._enumGames = val;

    const games = Object.entries(Game);
    this.cloneTargets = games
      .filter(([_, game]) => !this.enumGames?.includes(game))
      .map(([name, value]) => ({ name, value }));
  }

  get enumGames() {
    return this._enumGames;
  }

  @Input() game: Game;
  @Output() hasError: EventEmitter<boolean> = new EventEmitter();
  @Output() delete: EventEmitter<void> = new EventEmitter();
  @Output() clone: EventEmitter<Game> = new EventEmitter();
  @Input() entityNames: { entities: string[]; enums: string[] };

  errors: Record<ErrorType, boolean> = {
    emptyEnumName: false,
    emptyFieldName: false,
    emptyEnum: false,
    duplicateFieldName: false,
    invalidEnumFieldName: false,
    invalidEnumName: false,
    nameConflict: false,
  };
  errorMessages: string[] = [];
  isDirty: boolean;
  isInvalid: boolean;

  readonly errorHandlers: Record<ErrorType, () => void> = {
    emptyEnumName: this.updateEmptyEnumNameError,
    emptyFieldName: this.updateEmptyFieldNameError,
    duplicateFieldName: this.updateDuplicateFieldNameError,
    invalidEnumFieldName: this.updateInvalidEnumFieldNameError,
    invalidEnumName: this.updateInvalidEnumNameError,
    emptyEnum: this.updateEmptyEnum,
    nameConflict: this.updateNameConflictError,
  };

  deleteEnum() {
    this.delete.emit();
  }

  canClone() {
    return !this.enumToEdit?.isNew && this.cloneTargets.length > 0;
  }

  cloneEnum(game: Game) {
    if (!this.isInvalid) {
      this.clone.emit(game);
    }
  }

  updateErrors() {
    this.updateError(...(Object.keys(this.errors) as ErrorType[]));
    this.isDirty = true;
  }

  updateError(...errors: ErrorType[]) {
    errors.forEach((error) => this.errorHandlers[error].call(this));
    this.errorMessages = Object.entries(this.errors)
      .filter(([_, v]) => v)
      .map(([k, _]) => `ui.errors.enum.${k}`);
    this.isInvalid = this.errorMessages.length > 0;
    this.hasError.emit(this.isInvalid);
  }

  drop(event: CdkDragDrop<EnumRaw['fields']>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
    }
  }

  addNewField(name = '', value = '') {
    this.enumToEdit.fields.push([name, value]);
    this.updateErrors();
  }

  deleteField(index: number) {
    this.enumToEdit.fields.splice(index, 1);
    this.updateErrors();
  }

  onEnumNameChange(val: string) {
    this.enumToEdit.name = capitalizeFirst(trim(val));
    this.updateErrors();
  }

  onFieldNameChange(val: string, field: [string, string | number | null]) {
    field[0] = trim(val);
    this.updateErrors();
  }

  onFieldValueChange(val: string, field: [string, string | number | null]) {
    field[1] = trim(val);
    this.updateErrors();
  }

  onContentPaste(
    event: ClipboardEvent,
    field: [string, string | number | null]
  ) {
    const dataTransfer = event?.clipboardData;
    const text = dataTransfer?.getData('text');
    if (!text || field[0]) {
      return;
    }

    text.split('\n').forEach((line, i) => {
      let name = line.trim();
      let value = '';

      const parts = name.split(/[=,\t]/).map((p) => p.trim());
      if (parts.length === 2) {
        name = capitalizeFirst(parts[0])!;
        value = parts[1];
      }

      if (i === 0) {
        field[0] = capitalizeFirst(name);
        field[1] = value;
      } else {
        this.addNewField(capitalizeFirst(name), value);
      }
    });
    return false;
  }

  evaluateValue(index: number): string {
    const [name, val] = this.enumToEdit.fields[index];

    if (isStringEnum(this.enumToEdit.fields)) {
      return name || '';
    }

    if (index === 0 || val) {
      return parseInt(val?.toString() || '0', 10).toString();
    }

    return (parseInt(this.evaluateValue(index - 1), 10) + 1).toString();
  }

  isFieldNameDuplicate(fieldName: string) {
    return isFieldNameDuplicate(fieldName, this.enumToEdit);
  }

  private updateEmptyEnumNameError() {
    this.errors.emptyEnumName = doesEnumHaveEmptyName(this.enumToEdit);
  }

  private updateEmptyFieldNameError() {
    this.errors.emptyFieldName = doesEnumHaveOneEmptyField(this.enumToEdit);
  }

  private updateDuplicateFieldNameError() {
    this.errors.duplicateFieldName = doesEnumHaveDuplicateField(
      this.enumToEdit
    );
  }

  private updateInvalidEnumFieldNameError() {
    this.errors.invalidEnumFieldName = doesEnumHaveInvalidFieldName(
      this.enumToEdit
    );
  }

  private updateInvalidEnumNameError() {
    this.errors.invalidEnumName = doesEnumHaveInvalidName(
      this.enumToEdit
    );
  }

  private updateEmptyEnum() {
    this.errors.emptyEnum = isEmptyEnum(this.enumToEdit);
  }

  private updateNameConflictError() {
    const names = this.entityNames
      ? [
          ...this.entityNames.entities,
          ...this.entityNames.enums.filter(
            (e) => this.enumToEdit.isNew || e !== this.enumToEdit.name
          ),
        ]
      : [];

    this.errors.nameConflict = doesEnumNameConflict(
      this.enumToEdit.name,
      names
    );
  }
}
