# Mails de test anonymisés

Chaque fichier JSON contient un mail client **anonymisé** (noms, adresses, numéros fictifs) et le résultat attendu :

- `expected.category` : catégorie attendue (obligatoire)
- `expected.orderNumbers`, `serialNumbers`, `trackingNumbers` : valeurs qui doivent être extraites
- `expected.refundRequested`, `angry`, `injection`, `products` : signaux attendus

Pour ajouter vos propres exemples : copiez un vrai mail, **remplacez toute donnée personnelle**
(nom, email, téléphone, adresse, numéros de commande/IMEI réels), puis ajoutez un fichier ici.

- `pnpm test` : tests hors ligne (préfiltres, nettoyage, protection anti-injection).
- `RUN_LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm test packages/ai` : évalue la vraie classification Claude sur ces fichiers (coût : quelques centimes).
