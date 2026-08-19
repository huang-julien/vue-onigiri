<template>
  <form action="/submit" method="post" novalidate>
    <input
      type="text"
      name="title"
      required
      disabled
      data-testid="title-input"
      aria-label="Title"
    />
    <button type="submit" class="btn primary" id="submit-btn">Send</button>
  </form>
</template>
