import { Component } from '@angular/core';
import { UiFacade, ChangesFacade, ExtensionsFacade } from '../../../state';

@Component({
    selector: 'scl-footer',
    templateUrl: './footer.component.html',
    styleUrls: ['./footer.component.scss'],
    standalone: false
})
export class FooterComponent {
  lastUpdate$ = this._extensions.lastUpdate$;
  displayLastUpdate$ = this._ui.displayLastUpdated$;
  hasChanges$ = this._changes.hasChanges$;
  isUpdating$ = this._changes.isUpdating$;
  version$ = this._extensions.version$;

  constructor(
    private _changes: ChangesFacade,
    private _ui: UiFacade,
    private _extensions: ExtensionsFacade
  ) {}

  submitChanges() {
    this._changes.submitChanges();
  }
}
