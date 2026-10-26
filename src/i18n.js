// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. The connection status and the button answer
// are { en, fr }; errors thrown to Gladys are English (one language per
// message, like the core's); the device texts (names, program, weather, hot
// water mode, status) follow the language chosen in the configuration.
// -----------------------------------------------------------------------------

import { CODES } from './atag/errors.js';
import { BOILER_FEATURES as BF, THERMOSTAT_FEATURES as TF } from './constants.js';

const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const seconds = (ms) => Math.max(1, Math.round(ms / 1000));

/** Why the thermostat failed, in a few words (codes and statuses only). */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.RESET:
      return {
        en: 'connection closed by the thermostat',
        fr: 'connexion fermée par le thermostat',
      };
    case CODES.TIMEOUT:
    case CODES.NO_TIME:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.UNAUTHORIZED:
      return { en: 'pairing not confirmed', fr: 'appairage non confirmé' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    case CODES.BUSY:
      return {
        en: 'the thermostat has not answered the previous request yet',
        fr: 'le thermostat n’a pas encore répondu à la requête précédente',
      };
    case CODES.REFUSED:
      return {
        en: 'values refused by the last check',
        fr: 'valeurs refusées par le dernier contrôle',
      };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const RETRY = (delay) => ({
  en: `Retried in ${minutes(delay)} min.`,
  fr: `Nouvel essai dans ${minutes(delay)} min.`,
});

const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ deviceId, stale, unwritable, notApplied }) =>
      join(
        {
          en: `The thermostat ${deviceId} answers.`,
          fr: `Le thermostat ${deviceId} répond.`,
        },
        stale
          ? {
              en: 'Its report has not moved for more than 2 hours: values not published.',
              fr: 'Son rapport ne bouge plus depuis plus de 2 heures : valeurs non publiées.',
            }
          : { en: '', fr: '' },
        notApplied
          ? {
              en: 'The last command is not seen on the thermostat at the read that follows it.',
              fr: 'La dernière commande n’apparaît pas sur le thermostat à la relecture qui la suit.',
            }
          : { en: '', fr: '' },
        unwritable
          ? {
              en: 'The data of the integration (/data) cannot be written: a restart will ask for the pairing again.',
              fr: 'Les données de l’intégration (/data) ne peuvent pas être écrites : un redémarrage redemandera l’appairage.',
            }
          : { en: '', fr: '' },
      ),
    dataUnreadable: {
      en: 'The data of the integration (/data) cannot be read: the pairing identity is not rewritten and nothing is sent to the thermostat. Read again every minute. If it lasts, uninstall then reinstall the integration (uninstalling erases its data): a new pairing will be asked on the screen of the thermostat.',
      fr: 'Les données de l’intégration (/data) sont illisibles : l’identité d’appairage n’est pas réécrite et rien n’est envoyé au thermostat. Nouvelle lecture toutes les minutes. Si cela dure, désinstallez puis réinstallez l’intégration (la désinstallation efface ses données) : un nouvel appairage sera demandé sur l’écran du thermostat.',
    },
    configNotRead: (delay) => ({
      en: `The configuration of Gladys is not read yet. Asked again in ${minutes(delay)} min.`,
      fr: `La configuration de Gladys n’est pas encore lue. Nouvel essai dans ${minutes(delay)} min.`,
    }),
    pairingStopped: {
      en: 'Pairing not confirmed on the screen of the thermostat: no more automatic requests (a read every hour sees a pairing confirmed late). Press "Test the connection" (or save the configuration) to send one again.',
      fr: 'Appairage non confirmé sur l’écran du thermostat : plus de demande automatique (une lecture par heure voit un appairage confirmé tard). Appuyez sur « Tester la connexion » (ou enregistrez la configuration) pour en renvoyer une.',
    },
    httpError: (status, delay) =>
      join(
        {
          en: `The thermostat answers with HTTP error ${status}.`,
          fr: `Le thermostat répond par une erreur HTTP ${status}.`,
        },
        RETRY(delay),
      ),
    hostEmpty: {
      en: 'Enter the address of the thermostat.',
      fr: 'Indiquez l’adresse du thermostat.',
    },
    hostInvalid: {
      en: 'The address of the thermostat is not valid (IP address or name, with an optional port).',
      fr: 'L’adresse du thermostat n’est pas valide (adresse IP ou nom, port facultatif).',
    },
    hostCredentials: {
      en: 'The address must not carry a user name or a password.',
      fr: 'L’adresse ne doit pas contenir d’identifiant ni de mot de passe.',
    },
    hostHttps: {
      en: 'The thermostat has no https on its local port: enter the address without https://.',
      fr: 'Le thermostat n’a pas de https sur son port local : indiquez l’adresse sans https://.',
    },
    dhwMaxInvalid: (floor, hardMax, used) => ({
      en: `The hot water cap must be a number from ${floor} to ${hardMax} °C: ${used} °C is used.`,
      fr: `Le plafond d’eau chaude doit être un nombre de ${floor} à ${hardMax} °C : ${used} °C est utilisé.`,
    }),
    pairing: (delay) =>
      join(
        {
          en: 'Confirm the pairing of "Gladys" on the screen of the thermostat.',
          fr: 'Confirmez l’appairage de « Gladys » sur l’écran du thermostat.',
        },
        {
          en: `Asked again in ${minutes(delay)} min.`,
          fr: `Nouvelle demande dans ${minutes(delay)} min.`,
        },
      ),
    unreachable: (err, delay) =>
      join(
        {
          en: `The thermostat does not answer (${reasonOf(err).en}).`,
          fr: `Le thermostat ne répond pas (${reasonOf(err).fr}).`,
        },
        RETRY(delay),
      ),
    notThermostat: (delay) =>
      join(
        {
          en: 'This address does not answer like an Atag One (check the address and the port, 10000 by default).',
          fr: 'Cette adresse ne répond pas comme un Atag One (vérifiez l’adresse et le port, 10000 par défaut).',
        },
        RETRY(delay),
      ),
  },
  test: {
    ok: ({ deviceId, ago }) => ({
      en: `The thermostat ${deviceId} answers (last read ${seconds(ago)} s ago).`,
      fr: `Le thermostat ${deviceId} répond (dernière lecture il y a ${seconds(ago)} s).`,
    }),
    wait: (left) => ({
      en: `Not read again sooner than every minute: next read in ${seconds(left)} s.`,
      fr: `Pas de relecture plus souvent qu’une fois par minute : prochaine lecture dans ${seconds(left)} s.`,
    }),
  },
  errors: {
    unknownDevice: 'Unknown device or feature',
    invalidValue: (min, max) => `Value refused: a temperature from ${min} to ${max} °C is expected`,
    invalidMode:
      'Value refused: the local interface of the Atag One (pyatag, Home Assistant) offers Heating (1) and Auto (3) only, no Off; to heat less, lower the room setpoint (down to 4 °C)',
    invalidNumber: 'Value refused: a number is expected',
    dhwFahrenheit:
      'Hot water setpoint not offered on a thermostat set to Fahrenheit: unit not verified, nothing sent',
    dhwBounds:
      'The thermostat gives no usable hot water bounds (dhw_min_set, dhw_max_set): nothing sent',
    tooMany: (n) =>
      `Refused: at most ${n} raises (or mode changes) per minute; a lowering is never held back`,
    previousBusy:
      'The thermostat has not answered the previous command yet: nothing sent, try again in a few seconds',
    dataUnreadable: 'The data of the integration (/data) cannot be read: nothing sent',
    setpointDisabled:
      'Changing the room setpoint is disabled (tick "Allow changing the room setpoint")',
    modeDisabled: 'Changing the mode is disabled (tick "Allow changing the mode")',
    dhwDisabled:
      'Changing the hot water setpoint is disabled (tick "Allow changing the hot water setpoint")',
    notConnected: 'The thermostat is not connected',
    pairing: 'The pairing is not confirmed on the screen of the thermostat',
    configChanged: 'The configuration changed: command refused',
    tooSlow: 'The thermostat is too slow: nothing sent',
    unknownState: (err) => `State not read (${reasonOf(err).en}): nothing sent`,
    otherThermostat: 'Another thermostat answers at this address: nothing sent',
    notSent: (err) => `Not sent (${reasonOf(err).en})`,
    refused: (err) => `Sent, refused by the thermostat (${reasonOf(err).en})`,
    noAnswer: (err) =>
      `Sent, no answer from the thermostat (${reasonOf(err).en}): the read 5 s later tells whether it was applied`,
    configNotRead: 'The configuration of Gladys could not be read: try again in a moment',
    testTooLong: 'The thermostat did not answer in time',
  },
};

const DEVICE_TEXTS = {
  fr: {
    thermostat: (id) => `Thermostat Atag One ${id}`,
    boiler: (id) => `Chaudière Atag ${id}`,
    features: {
      [TF.TEMPERATURE]: 'Température de la pièce',
      [TF.TARGET]: 'Consigne de la pièce',
      [TF.MODE]: 'Mode de régulation',
      [TF.HEATING]: 'Chauffe',
      [TF.PROGRAM]: 'Programme',
      [TF.OUTSIDE_TEMPERATURE]: 'Température extérieure',
      [TF.OUTSIDE_AVERAGE]: 'Température extérieure moyenne',
      [TF.WEATHER]: 'Météo',
      [BF.WATER_TEMPERATURE]: 'Température de départ',
      [BF.RETURN_TEMPERATURE]: 'Température de retour',
      [BF.PRESSURE]: 'Pression du circuit',
      [BF.BURNER]: 'Brûleur allumé',
      [BF.FLAME]: 'Modulation du brûleur (%)',
      [BF.DHW_TEMPERATURE]: 'Température de l’eau chaude',
      [BF.DHW_TARGET]: 'Consigne d’eau chaude',
      [BF.DHW_HEATING]: 'Production d’eau chaude',
      [BF.DHW_MODE]: 'Mode d’eau chaude',
      [BF.BURNING_HOURS]: 'Heures de fonctionnement du brûleur',
      [BF.STATUS]: 'État',
    },
    modes: { heat: 'Chauffage (régulation classique)', auto: 'Automatique (selon la météo)' },
    programs: {
      manual: 'Manuel',
      automatic: 'Programme',
      vacation: 'Vacances',
      extend: 'Prolongation',
      fireplace: 'Feu de cheminée',
    },
    dhwModes: { performance: 'Confort', eco: 'Éco' },
    weather: {
      sunny: 'Ensoleillé',
      clear: 'Dégagé',
      rainy: 'Pluie',
      snowy: 'Neige',
      haily: 'Grêle',
      windy: 'Vent',
      misty: 'Brume',
      cloudy: 'Nuageux',
      partly_sunny: 'Éclaircies',
      partly_cloudy: 'Partiellement nuageux',
      shower: 'Averses',
      lightning: 'Orage',
      hurricane: 'Tempête',
      unknown: 'Inconnue',
    },
    status: { idle: 'Veille', ch: 'Chauffage', dhw: 'Eau chaude', both: 'Chauffage et eau chaude' },
  },
  en: {
    thermostat: (id) => `Atag One thermostat ${id}`,
    boiler: (id) => `Atag boiler ${id}`,
    features: {
      [TF.TEMPERATURE]: 'Room temperature',
      [TF.TARGET]: 'Room setpoint',
      [TF.MODE]: 'Control mode',
      [TF.HEATING]: 'Heating',
      [TF.PROGRAM]: 'Program',
      [TF.OUTSIDE_TEMPERATURE]: 'Outside temperature',
      [TF.OUTSIDE_AVERAGE]: 'Average outside temperature',
      [TF.WEATHER]: 'Weather',
      [BF.WATER_TEMPERATURE]: 'Flow temperature',
      [BF.RETURN_TEMPERATURE]: 'Return temperature',
      [BF.PRESSURE]: 'Water pressure',
      [BF.BURNER]: 'Burner on',
      [BF.FLAME]: 'Burner modulation (%)',
      [BF.DHW_TEMPERATURE]: 'Hot water temperature',
      [BF.DHW_TARGET]: 'Hot water setpoint',
      [BF.DHW_HEATING]: 'Hot water production',
      [BF.DHW_MODE]: 'Hot water mode',
      [BF.BURNING_HOURS]: 'Burner running hours',
      [BF.STATUS]: 'Status',
    },
    modes: { heat: 'Heating (regular control)', auto: 'Auto (weather-dependent)' },
    programs: {
      manual: 'Manual',
      automatic: 'Schedule',
      vacation: 'Vacation',
      extend: 'Extend',
      fireplace: 'Fireplace',
    },
    dhwModes: { performance: 'Comfort', eco: 'Eco' },
    weather: {
      sunny: 'Sunny',
      clear: 'Clear',
      rainy: 'Rainy',
      snowy: 'Snowy',
      haily: 'Hail',
      windy: 'Windy',
      misty: 'Misty',
      cloudy: 'Cloudy',
      partly_sunny: 'Partly sunny',
      partly_cloudy: 'Partly cloudy',
      shower: 'Showers',
      lightning: 'Lightning',
      hurricane: 'Storm',
      unknown: 'Unknown',
    },
    status: { idle: 'Standby', ch: 'Heating', dhw: 'Hot water', both: 'Heating and hot water' },
  },
};

/** The device texts in `language` (French when unknown). */
export const texts = (language) => DEVICE_TEXTS[language] ?? DEVICE_TEXTS.fr;

/** The boiler status in words. */
export function statusText(report, language) {
  const t = texts(language).status;
  if (report.chHeating === null || report.dhwHeating === null) return null;
  if (report.chHeating && report.dhwHeating) return t.both;
  if (report.chHeating) return t.ch;
  if (report.dhwHeating) return t.dhw;
  return t.idle;
}
