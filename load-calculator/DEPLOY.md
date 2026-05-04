# CEC Residential Load Calculator Deployment

This folder is a static website. It does not need Node, PHP, a database, or a build step.

## Files to Upload

- `index.html`
- `styles.css`
- `app.js`

Upload the whole `load-calculator` folder to your website, for example:

```text
public_html/load-calculator/
```

Then open:

```text
https://your-domain.ca/load-calculator/
```

## Embed Option

If you want it inside another page, keep this folder uploaded and embed it with an iframe:

```html
<iframe
  src="/load-calculator/"
  title="CEC Residential Load Calculator"
  style="width: 100%; min-height: 1100px; border: 0;"
></iframe>
```

## Updating Later

Replace the three files in the website folder with the new versions. The cache version query strings in `index.html` help browsers pick up changed CSS and JavaScript.
