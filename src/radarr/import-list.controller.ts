import {
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ImportListGuardService } from './import-list-guard.service';

@Controller('import-lists')
export class ImportListController {
  constructor(private readonly importListGuard: ImportListGuardService) {}

  /**
   * Acknowledge that a held Radarr import list really collapsed, so the next
   * evaluation releases its movies. Returns 409 if the list isn't held.
   *
   * @see docs/adr/0003-import-list-collapse-holds-membership.md
   */
  @Post(':listId/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledge(@Param('listId', ParseIntPipe) listId: number) {
    if (this.importListGuard.acknowledge(listId) === 'not_held') {
      throw new ConflictException(
        `Import list ${listId} is not held, so there is nothing to acknowledge.`,
      );
    }

    return {
      list_id: listId,
      acknowledged: true,
      message: `Import list ${listId} acknowledged. The next evaluation releases its held movies.`,
    };
  }
}
