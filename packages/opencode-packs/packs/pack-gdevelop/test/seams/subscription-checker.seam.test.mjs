// Phase 1 seam: subscription dialog gate.
// Audit: `Profile/Subscription/SubscriptionChecker.js:66-87` — both
// closures funnel through `hasValidSubscriptionPlan`.
import { describe, it } from 'node:test';
import {
  UPSTREAM_DIR,
  readUpstream,
  mustContain,
  mustBeNearLine,
} from './helpers.mjs';

const REL = 'newIDE/app/src/Profile/Subscription/SubscriptionChecker.js';
import fs from 'node:fs';

const HAS_UPSTREAM = fs.existsSync(UPSTREAM_DIR);
if (!HAS_UPSTREAM) {
  describe('seam: subscription-checker.seam.test.mjs (skipped: no UPSTREAM_DIR checkout)', () => {
    it('skips gracefully without an upstream checkout', () => {
      console.log('skip: no UPSTREAM_DIR');
    });
  });
} else {
  describe('seam: SubscriptionChecker dialog gate', () => {
    const file = readUpstream(REL);

    it('exposes the checker interface shape', () => {
      mustContain(file, 'checkUserHasSubscription: () => boolean', {
        what: 'SubscriptionCheckerInterface.checkUserHasSubscription',
      });
      mustContain(file, 'hasUserSubscription: () => boolean', {
        what: 'SubscriptionCheckerInterface.hasUserSubscription',
      });
    });

    it('checkUserHasSubscription sits at its audited hunk (~line 66, tolerance ±40)', () => {
      mustBeNearLine(
        file,
        /const checkUserHasSubscription(?![\w$])/,
        66,
        40,
        'checkUserHasSubscription'
      );
    });

    it('both closures consult hasValidSubscriptionPlan', () => {
      mustContain(
        file,
        'hasValidSubscriptionPlan(authenticatedUser.subscription)',
        { what: 'funnel shared by both closures' }
      );
      mustBeNearLine(
        file,
        /const hasUserSubscription(?![\w$])/,
        85,
        40,
        'hasUserSubscription'
      );
    });

    it('denial opens the paywall dialog', () => {
      mustContain(file, 'setDialogOpen(true)', {
        what: 'dialog-open on failed check',
        hint: 'Phase 2 hunk 3 stubs both closures to `return true` so this never fires',
      });
      mustContain(file, 'sendSubscriptionCheckDialogShown', {
        what: 'analytics ping on dialog show',
      });
    });
  });

}
