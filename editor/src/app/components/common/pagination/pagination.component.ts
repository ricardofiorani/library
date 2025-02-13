import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { chunk } from 'lodash';

@Component({
    selector: 'scl-pagination',
    templateUrl: './pagination.component.html',
    styleUrls: ['./pagination.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class PaginationComponent {
  readonly pageSize = 100;
  private _pages: number[];

  @Input() set total(length: number) {
    this._pages = chunk({ length }, this.pageSize).map((_, i) => i + 1);
  }

  get total() {
    return this.pages.length;
  }

  get pages() {
    return this._pages;
  }

  @Input() currentPage: number | 'all' = 1;
  @Output() pageChange: EventEmitter<number | 'all'> = new EventEmitter();

  changePage(index: number | 'all') {
    this.pageChange.emit(index);
    return false;
  }
}
