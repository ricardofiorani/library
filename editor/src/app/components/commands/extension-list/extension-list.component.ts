import { Component, Input } from '@angular/core';
import { Extension, Game, ViewContext } from 'src/app/models';

@Component({
    selector: 'scl-extension-list',
    templateUrl: './extension-list.component.html',
    styleUrls: ['./extension-list.component.scss'],
    standalone: false
})
export class ExtensionListComponent {
  ViewContext = ViewContext;

  private _game: Game;
  games: Game[];

  @Input() extensions: Extension[];
  @Input() viewContext: ViewContext;

  @Input() set game(val: Game) {
    this.games = Object.values(Game);
    this._game = val;
  }

  get game() {
    return this._game;
  }

  get baseHref() {
    if (this.viewContext === ViewContext.Code) {
      return `/${this.game}/native/versions`
    }
    return `/${this.game}/script/extensions`;
  }

  getGameLinks() {
    return this.games.map((game) => ({
      game,
      route: ['/', game, 'extensions'],
    }));
  }
}
