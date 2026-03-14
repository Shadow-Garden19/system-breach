# Pousser ce projet sur GitHub

Le dépôt Git est déjà initialisé et le premier commit est fait.

## 1. Créer un nouveau dépôt sur GitHub

1. Va sur **https://github.com/new**
2. **Repository name** : `system-breach` (ou un autre nom si tu préfères)
3. **Public**
4. Ne coche **pas** "Add a README" (le projet en a déjà un)
5. Clique sur **Create repository**

## 2. Lier le projet et pousser

Dans un terminal, place-toi dans le dossier du projet puis exécute (remplace **TON_USERNAME** par ton identifiant GitHub) :

```bash
cd C:\Users\ethan\system-breach

git remote add origin https://github.com/TON_USERNAME/system-breach.git
git push -u origin main
```

Si tu utilises SSH :

```bash
git remote add origin git@github.com:TON_USERNAME/system-breach.git
git push -u origin main
```

Git te demandera peut-être de te connecter (identifiants GitHub ou token).

Après le push, ton projet sera visible sur :  
**https://github.com/TON_USERNAME/system-breach**
