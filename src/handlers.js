// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle ------------------------------------------
  gladys.onScanRequest(() => app.publishDiscovery());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));
  // Updated: the SDK forgot its states, and Gladys may have reset its badge.
  gladys.onDeviceUpdated((device) => app.deviceUpdated(device));

  // --- Commands: room setpoint, control mode, hot water setpoint (each behind an option)
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // --- Configuration screen button ---------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // --- Configuration saved by the user: the pairing is asked again.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated: restarting');
    return app.start(config, { force: true });
  });

  // --- Connection lifecycle: every connection reads the configuration and
  // publishes again what is fresh; the same configuration keeps the client,
  // the pairing state and the pace. A configuration Gladys does not give is
  // asked again without end (30 s, 1 min... 10 min at most), the status
  // saying so; one chain at a time, cleared on disconnection.
  gladys.on('connected', () =>
    app.startFromGladys().catch((err) => logger?.error('Start failed', err)),
  );
  gladys.on('disconnected', () => app.pause());
}
