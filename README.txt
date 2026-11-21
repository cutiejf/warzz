Chino War redesign - drop-in files

REPLACE in the repo:   index.html
ADD to the repo root:  redesign.css, redesign.js
DO NOT CHANGE:         game.js, styles.css, cards/, all images

redesign.css loads after styles.css and overrides the old three-column layout,
so the original animation CSS stays exactly as it was.
To undo: restore the old index.html (the two new files are then ignored).
