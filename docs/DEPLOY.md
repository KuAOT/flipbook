# Deploying the flipbooks to Firebase Hosting

The flipbooks are plain static files. They go into your existing alumni site's
Hosting `public` directory as a `books/` subfolder — no `firebase.json` changes
needed.

## One-time

1. In your existing alumni-site project (the one with `firebase.json`), find the
   Hosting `public` directory (often `public/` or `dist/`).
2. Copy the book folders into a `books/` subfolder there. Each book folder must
   contain `index.html`, `book.js`, `vendor/`, `pages/`, `thumbs/`:

       <public>/books/Samsen45-M3-2540/

   Do NOT copy `books/_template/`.

## Deploy

    firebase deploy --only hosting

## Result

Your book is live at:

    https://<your-site>/books/Samsen45-M3-2540/

Link to that URL from anywhere on your alumni website.

## Adding the second book later

    node tools/extract.mjs "<fliphtml5-url-of-book-2>" "Samsen45-M6-2543"

The extractor copies the viewer template and library into the new book folder
automatically. Then copy `books/Samsen45-M6-2543/` into `<public>/books/` and
run `firebase deploy` again.
