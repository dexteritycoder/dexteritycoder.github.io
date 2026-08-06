# How to Make Header and Footer Appear on Every Page Without Copying Them Manually Using JS

abhinav singh

2 min read

Oct 23, 2025

I’m a web developer, and I started learning web development back in early 2020. I began with static websites built using HTML, CSS, and JavaScript, and I’ve created hundreds of them since then. But one question always stayed in my mind, how can I make my website more modular so that components like the header, footer, and navigation bar remain independent of individual pages?

I finally figured it out just two days ago while maintaining one of my two-year-old web pages. I realized it was time to improve its modularity by moving the header, footer, and other repeating HTML blocks into separate files and then loading them dynamically.

So, I thought I should share this simple trick with everyone, especially beginners, to help make their upcoming projects more robust and efficient.

Here’s the small JavaScript snippet you can use:

```js
fetch('header.html')
  .then(response => response.text())
  .then(data => {
    document.getElementById('header').innerHTML = data;
  });
```

Here’s the general structure for your code:

```js
fetch('<your file name>')
  .then(response => response.text())
  .then(data => {
    document.getElementById('ID for the element').innerHTML = data;
  });
```

## Example

`index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    <div id="header"></div>
    <div id="footer"></div>
</body>
<script>
// for header
fetch('header.html')
  .then(response => response.text())
  .then(data => {
    document.getElementById('header').innerHTML = data;
  });

// for footer
fetch('footer.html')
  .then(response => response.text())
  .then(data => {
    document.getElementById('footer').innerHTML = data;
  });
</script>
</html>
```

`header.html`

```html
<div class="header">
  this is a header
</div>
```

`footer.html`

```html
<div class="footer">
  this is a footer
</div>
```

Remember, component files like `header.html` and `footer.html` should only contain the component’s section, no `<html>`, `<head>`, or `<body>` tags.

This is how you can easily reuse your HTML blocks across multiple pages without repeating code manually.

If you found this helpful, please follow me for more articles like this and subscribe to my newsletter to get notified about new content. Thank you.
