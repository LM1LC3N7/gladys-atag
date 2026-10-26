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
- **Appairage** : Gladys lit d'abord le thermostat ; s'il répond que Gladys
  n'est pas (ou plus) acceptée, Gladys envoie une demande d'appairage au nom
  de « Gladys », que vous confirmez sur l'écran du thermostat. Sans
  confirmation, la demande est renvoyée après 1 min, puis 2, 4, 8, 15 min,
  **8 demandes au plus** ; ensuite Gladys n'en envoie plus seule et le statut
  vous dit d'appuyer sur **Tester la connexion** (ou d'enregistrer la
  configuration) pour en renvoyer une. Ce compte est gardé à travers un
  redémarrage. L'identité que Gladys donne au thermostat est tirée au sort
  une fois et gardée dans les données de l'intégration (`/data`) :
  - pas encore de fichier (premier démarrage) : une identité neuve est tirée
    et écrite ;
  - fichier présent mais illisible (droits, disque, contenu abîmé) : Gladys
    ne le réécrit pas et n'envoie rien au thermostat (pas de demande
    d'appairage avec une nouvelle identité) ; le statut le dit et le fichier
    est relu chaque minute ;
  - fichier impossible à écrire : l'intégration fonctionne, mais le statut
    prévient qu'un redémarrage redemandera l'appairage.
- **Commandes** : trois options, toutes désactivées par défaut (voir
  Commandes).
- **Plafond d'eau chaude (°C)** : la consigne d'eau chaude la plus haute que
  Gladys peut envoyer, 55 °C par défaut et 60 °C au plus (une valeur hors de
  30 à 60 °C est signalée dans le statut et 55 °C reste utilisé).
- **Langue des appareils** : français (par défaut) ou anglais, pour les noms
  des appareils et les textes du programme, de la météo, du mode d'eau chaude
  et de l'état.

Ouvrez ensuite l'onglet **Découverte** et créez le thermostat et la chaudière.
Le bouton **Tester la connexion** relit la configuration, redemande
l'appairage si besoin, lit le thermostat si la dernière lecture date d'au
moins une minute, et rend compte.

## Commandes

Par défaut Gladys ne fait que lire. Chaque option, une fois cochée, permet au
tableau de bord, aux scènes, aux assistants vocaux (Siri / HomeKit…) et au
service Thermostat de Gladys de changer une seule chose :

- **Consigne de la pièce** (`Autoriser le changement de la consigne de la
pièce`) : de **4 à 27 °C** (la plage de la molette de l'Atag One), au demi
  degré ; une valeur en dehors est refusée, pas ramenée dans les bornes.
- **Mode de régulation** (`Autoriser le changement du mode de régulation`) :
  **Chauffage** (régulation classique, valeur 1) ou **Automatique** (selon la
  météo, valeur 3). L'interface locale connue de l'Atag One (pyatag, Home
  Assistant) ne propose pas d'arrêt : la valeur Arrêt (0), envoyée par
  exemple par le service Thermostat ou un assistant vocal, est refusée avec
  un message. Pour moins chauffer depuis Gladys, baissez la consigne (jusqu'à
  4 °C, option cochée) ; pour arrêter le chauffage, faites-le sur le
  thermostat. Le programme (manuel, vacances…) est en lecture seule.
- **Consigne d'eau chaude** (`Autoriser le changement de la consigne d'eau
chaude`) : entre le minimum et le maximum que le thermostat annonce
  (`dhw_min_set`, `dhw_max_set`, relus à chaque commande) et sous le plafond
  de la configuration (55 °C par défaut, 60 °C au plus) ; une valeur en dehors
  est refusée, pas ramenée dans les bornes. Pas proposée sur un thermostat
  réglé en Fahrenheit : on ne sait pas encore si ses valeurs d'eau chaude
  suivent cette unité (elles ne sont pas publiées non plus).

Aucune fonctionnalité n'est un interrupteur : « éteins tout » n'agit pas sur
la chaudière ni sur l'eau chaude.

Juste avant d'agir, Gladys relit le thermostat. **Rien n'est envoyé** dans les
cas suivants, chacun avec son message :

- l'option de la commande est décochée (vérifiée à l'arrivée de la commande
  et juste avant l'envoi) ;
- la valeur n'est pas un nombre, ou sort de ses bornes (pour l'eau chaude :
  celles du thermostat relues, sous le plafond) ;
- l'intégration n'a pas d'adresse valide, ou ses données (`/data`) sont
  illisibles ;
- l'appairage n'est pas confirmé (connu par une lecture précédente, ou dit
  par la relecture de la commande) ;
- la relecture échoue, ou la commande ne peut plus partir dans les 3,5 s qui
  suivent son arrivée (par exemple quand une commande précédente est encore
  en cours) ;
- un autre thermostat répond à l'adresse ;
- la configuration a changé entre-temps ;
- l'eau chaude est demandée sur un thermostat en Fahrenheit, ou le thermostat
  ne donne pas de bornes d'eau chaude utilisables ;
- plus de 6 commandes du même genre ont été envoyées dans la dernière minute
  (une scène qui boucle) ;
- la valeur est déjà celle demandée : la commande est alors un succès, sans
  envoi.

Une fois la commande partie (au plus 3,5 s après son arrivée), le thermostat
a 10 s pour répondre ; Gladys reçoit sa réponse au plus tard 4,3 s après la
commande. Trois issues :

- le thermostat a répondu : succès ;
- il n'a pas encore répondu à 4,3 s : succès « envoyée, pas encore de
  réponse », la suite est journalisée ;
- la connexion est coupée ou reste sans réponse avant 4,3 s : échec
  « envoyée, sans réponse du thermostat » — **la commande a pu être
  appliquée** ; un refus HTTP du thermostat donne « refusée ».

Dans tous les cas où la commande est partie, le thermostat est relu **5 s
après** : seule cette relecture change la valeur affichée. Si elle ne montre
pas la valeur demandée, le journal et le statut le disent. Une commande n'est
jamais renvoyée. Les commandes passent une par une, et les requêtes au
thermostat sont espacées d'au moins une seconde (il coupe les appels plus
rapprochés).

## Rafraîchissement et limites

- La boucle lit le thermostat toutes les **60 secondes**. Les états ont donc
  jusqu'à une minute de retard ; seules les valeurs qui changent sont
  envoyées à Gladys (et chacune au moins toutes les 30 minutes). Le bouton de
  test, la Découverte, une reconnexion à Gladys et un redémarrage de
  l'intégration ne lisent pas plus tôt que 60 s après la dernière lecture
  (son heure est gardée dans `/data` à chaque lecture). Une commande ajoute
  sa relecture fraîche et sa relecture de confirmation 5 s après.
- Une valeur lue il y a plus de 2 minutes n'est pas republiée (par exemple au
  retour de Gladys après une longue absence) : la lecture suivante, faite
  aussitôt si elle est due, publie les valeurs du moment.
- Chaque rapport du thermostat porte sa propre heure (`report_time`). Si elle
  ne bouge plus pendant plus de 2 heures, les valeurs ne sont plus publiées,
  le badge des appareils passe en « dégradé » et le statut le dit ; tout
  reprend dès que le rapport bouge. Cette heure est gardée à travers un
  redémarrage. Un thermostat qui ne donne pas cette heure ne peut pas être
  vérifié ainsi.
- Une valeur hors des bornes de sa fonctionnalité (une sonde absente, une
  réponse aberrante) n'est pas publiée.
- Les températures de l'eau et de l'extérieur sont des sondes : Gladys ne les
  compte pas dans la température de la pièce où se trouve le thermostat.
- Un thermostat réglé en Fahrenheit : températures de la pièce, de
  l'extérieur et du circuit converties en °C, consigne de la pièce envoyée en
  °F ; eau chaude ni publiée ni commandée (voir plus haut).
- Le thermostat est reconnu par son **identifiant** (`status.device_id`), pas
  par son adresse : si un autre thermostat répond à l'adresse, les appareils
  créés passent injoignables et le nouveau apparaît dans la Découverte.

## Problèmes de connexion

- **Appairage à confirmer** : voir Configuration.
- **Thermostat injoignable** : tous les appareils apparaissent injoignables ;
  nouvel essai après 1 min, puis de plus en plus rarement jusqu'à toutes les
  10 min. Une connexion que le thermostat ferme pendant une lecture est
  retentée (3 essais) ; une commande n'est pas renvoyée.
- **Le thermostat répond par une erreur HTTP N** : il répond, mais refuse ;
  même rythme de nouvel essai.
- **Cette adresse ne répond pas comme un Atag One** : vérifiez l'adresse et
  le port (10000 par défaut).
- **Configuration de Gladys pas encore lue** : l'intégration la redemande
  après 30 s, 1, 2, 4, 8 min puis toutes les 10 min, sans fin, et le statut le
  dit.
- Les journaux ne contiennent pas le texte des réponses du thermostat,
  seulement des codes (HTTP 500, pas de connexion…), ni l'identité
  d'appairage.

## Limites

- Un seul thermostat par intégration ; l'adresse est saisie (pas de
  découverte automatique sur le réseau).
- Le programme (manuel, vacances…) et le mode d'eau chaude (Confort / Éco)
  sont en lecture seule.
- Jamais testée sur un vrai thermostat.
