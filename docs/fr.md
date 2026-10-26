# Atag One

Votre thermostat **Atag One** (chaudières Atag) dans Gladys, par son interface
locale sur votre réseau (port 10000), sans cloud :

- le thermostat devient un appareil Gladys : **température de la pièce**,
  **consigne**, **mode de régulation** (Chauffage ou Automatique selon la
  météo), **chauffe**, **programme** (manuel, programme, vacances,
  prolongation, feu de cheminée), **température extérieure** (et sa moyenne),
  **météo** ;
- la chaudière en devient un autre : **températures de départ et de retour**,
  **pression du circuit** (bar), **brûleur allumé**, **modulation du brûleur**
  (%), **température de l'eau chaude**, **consigne d'eau chaude**, **production
  d'eau chaude**, **mode d'eau chaude** (Confort / Éco), **heures de
  fonctionnement du brûleur** et son **état** en texte (veille, chauffage, eau
  chaude).

> **Cette intégration n'a jamais été testée sur un vrai thermostat.** Cette
> première version a été écrite à partir de la bibliothèque pyatag et de
> l'intégration atag de Home Assistant, et testée seulement contre un faux
> thermostat. Dites sur le forum de Gladys ce qui marche et ce qui ne marche
> pas.

Intégration non officielle, sans lien avec Atag.

## Configuration

- **Adresse du thermostat** : son adresse IP sur votre réseau
  (`192.168.1.20`) ; un port peut suivre (`192.168.1.20:10000`, 10000 par
  défaut). Préférez l'adresse IP : un nom en `.local` (mDNS) ne se résout pas
  dans le conteneur de l'intégration. Donnez-lui une adresse fixe dans votre
  box. Le thermostat ne parle qu'en http simple sur ce port : une adresse
  `https://` est refusée avec un message clair. Aucun identifiant ni mot de
  passe : le thermostat reconnaît Gladys par l'appairage ci-dessous.
- **Appairage** : à la première lecture, le thermostat affiche sur son écran
  une demande d'appairage au nom de « Gladys ». Confirmez-la sur le
  thermostat. Tant qu'elle n'est pas confirmée, Gladys la redemande (après
  1 min, puis 2, 4, 8, 15 min au plus) et le statut de l'intégration le dit ;
  enregistrer la configuration ou appuyer sur **Tester la connexion** la
  redemande à la lecture suivante (jamais plus d'une lecture par minute).
  L'identité que Gladys donne au thermostat est tirée au sort une fois et
  gardée dans les données de l'intégration : si ces données sont perdues, le
  thermostat redemande une confirmation.
- **Commandes** : trois options, toutes désactivées par défaut (voir
  Commandes).
- **Plafond d'eau chaude (°C)** : la consigne d'eau chaude la plus haute que
  Gladys peut envoyer, 55 °C par défaut ; jamais plus de 60 °C quelle que
  soit la valeur saisie (une valeur hors de 30 à 60 °C est refusée avec un
  message et 55 °C reste utilisé).
- **Langue des appareils** : français (par défaut) ou anglais, pour les noms
  des appareils et les textes du programme, de la météo, du mode d'eau chaude
  et de l'état.

Ouvrez ensuite l'onglet **Découverte** et créez le thermostat et la chaudière.
Le bouton **Tester la connexion** redemande l'appairage si besoin, lit le
thermostat quand la cadence le permet (jamais plus d'une fois par minute) et
rend compte.

## Commandes

Par défaut Gladys ne fait que lire. Chaque option, une fois cochée, permet au
tableau de bord, aux scènes, aux assistants vocaux (Siri / HomeKit…) et au
service Thermostat de Gladys de changer une seule chose :

- **Consigne de la pièce** (`Autoriser le changement de la consigne de la
pièce`) : de **4 à 27 °C** (la plage de la molette de l'Atag One), au demi
  degré ; une valeur en dehors est refusée, jamais ramenée dans les bornes.
- **Mode de régulation** (`Autoriser le changement du mode de régulation`) :
  **Chauffage** (régulation classique, valeur 1) ou **Automatique** (selon la
  météo, valeur 3). Ce thermostat n'a pas de mode « arrêt » : la valeur 0 est
  refusée avec un message. Le programme (manuel, vacances…) est en lecture
  seule dans cette version.
- **Consigne d'eau chaude** (`Autoriser le changement de la consigne d'eau
chaude`) : entre le minimum et le maximum que le thermostat annonce, et
  sous le plafond de la configuration (55 °C par défaut, 60 °C au plus) ; une
  valeur en dehors est refusée, jamais ramenée dans les bornes.

Aucune fonctionnalité n'est un interrupteur : « éteins tout » ne peut pas
agir sur la chaudière ni sur l'eau chaude.

Pour chaque commande :

- Juste avant d'agir, Gladys relit le thermostat. Rien n'est envoyé dans les
  cas suivants : l'option est décochée (vérifiée à l'arrivée de la commande et
  juste avant l'envoi) ; la valeur est hors bornes ; l'appairage n'est pas
  confirmé ; la relecture échoue ou dépasse le budget de temps ; un autre
  thermostat répond à l'adresse ; la configuration a changé entre-temps ; la
  valeur est déjà celle demandée (la commande est alors un succès sans envoi).
- Quand la commande ne peut pas être vérifiée en 3,5 s, rien n'est envoyé et
  Gladys affiche un échec (pas d'action après un échec affiché). Une fois
  envoyée, Gladys répond au plus 4,3 s après votre commande.
- La valeur affichée ne change qu'à la **relecture 5 s après l'envoi** : c'est
  elle qui confirme la commande. Si le thermostat ne l'a pas appliquée, la
  valeur affichée reste l'ancienne.
- Les commandes passent une par une (un seul thermostat), et chaque requête
  au thermostat est espacée d'au moins une seconde (il coupe les appels plus
  rapprochés).

## Rafraîchissement et limites

- Le thermostat est lu toutes les **60 secondes**. Les états ont donc jusqu'à
  une minute de retard. Seules les valeurs qui changent sont envoyées à
  Gladys (et chacune au moins toutes les 30 minutes). Rien ne le lit plus
  souvent : ni le bouton de test, ni la Découverte, ni une reconnexion à
  Gladys, ni un redémarrage de l'intégration (l'heure de la dernière lecture
  est gardée).
- Chaque rapport du thermostat porte sa propre heure. Si elle ne bouge plus
  pendant plus de 2 heures, les valeurs ne sont plus publiées (elles seraient
  périmées), le badge des appareils passe en « dégradé » et le statut le dit ;
  tout reprend dès que le rapport bouge.
- Les températures de l'eau et de l'extérieur sont des sondes : Gladys ne les
  compte pas dans la température de la pièce où se trouve le thermostat.
- Un thermostat réglé en Fahrenheit est lu et commandé en °C (converti).
- Le thermostat est reconnu par son **identifiant** (`status.device_id`), pas
  par son adresse : si un autre thermostat répond à l'adresse, les appareils
  créés passent injoignables et le nouveau apparaît dans la Découverte.

## Problèmes de connexion

- **Appairage à confirmer** : voir Configuration. Un rapport avec un appairage
  perdu (le thermostat a retiré Gladys) revient à l'appairage.
- **Thermostat injoignable** : tous les appareils apparaissent injoignables ;
  nouvel essai après 1 min, puis de plus en plus rarement jusqu'à toutes les
  10 min (jamais plus vite que la lecture normale). Une connexion que le
  thermostat ferme pendant une lecture est retentée (3 essais) ; une commande
  n'est jamais renvoyée (elle a pu être appliquée : la relecture le dit).
- **Cette adresse ne répond pas comme un Atag One** : vérifiez l'adresse et
  le port (10000 par défaut).
- Les journaux ne contiennent pas le texte des réponses du thermostat,
  seulement des codes (HTTP 500, pas de connexion…), ni l'identité
  d'appairage.

## Limites

- Un seul thermostat par intégration ; l'adresse est saisie (pas de
  découverte automatique sur le réseau).
- Le programme (manuel, vacances…) et le mode d'eau chaude (Confort / Éco)
  sont en lecture seule.
- Jamais testée sur un vrai thermostat.
