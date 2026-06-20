DEPLOIEMENT RENDER — ETAPE PAR ETAPE
=====================================

ETAPE 1 — GitHub
1. Va sur https://github.com/signup (cree un compte si besoin)
2. Va sur https://github.com/new
3. Nom du repo : paripotes
4. Coche "Add a README" → Create repository

ETAPE 2 — Envoyer le code
Dans PowerShell :
  cd C:\Users\Rayan\PariPotes\server
  git remote add origin https://github.com/TON_PSEUDO/paripotes.git
  git branch -M main
  git commit -m "PariPotes CDM 2026"
  git push -u origin main
(Remplace TON_PSEUDO par ton nom GitHub)

ETAPE 3 — Render
1. https://render.com/register → connecte GitHub
2. Dashboard → New + → Blueprint
3. Connecte le repo paripotes
4. Render detecte render.yaml automatiquement
5. Ajoute les variables secretes :
   SMTP_USER = tryhardd71@gmail.com
   SMTP_PASS = (mot de passe application Gmail)
   SMTP_FROM = PariPotes <tryhardd71@gmail.com>
6. Apply → attends 3 minutes

ETAPE 4 — Ton lien permanent
  https://paripotes.onrender.com
  (ou le nom affiche par Render)

Envoie ce lien a tes potes !