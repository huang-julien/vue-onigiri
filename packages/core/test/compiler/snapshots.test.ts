import { describe, it, expect } from "vite-plus/test";
import { compileOnigiri, compileOnigiriInline } from "../../src/template-compiler";

describe("onigiri compiler", () => {
  describe("snapshots", () => {
    describe("basic elements", () => {
      it("simple div with text", () => {
        const result = compileOnigiri(`<div>Hello World</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("div with static class", () => {
        const result = compileOnigiri(`<div class="container">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("div with multiple attributes", () => {
        const result = compileOnigiri(`<div id="app" class="main" data-test="value">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("self-closing elements", () => {
        const result = compileOnigiri(`<input type="text" placeholder="Enter text" />`);
        expect(result.code).toMatchSnapshot();
      });

      it("nested elements", () => {
        const result = compileOnigiri(`
          <div class="outer">
            <div class="inner">
              <span>Nested text</span>
            </div>
          </div>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("multiple root elements (fragment)", () => {
        const result = compileOnigiri(`<div>First</div><span>Second</span><p>Third</p>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("interpolation", () => {
      it("simple variable", () => {
        const result = compileOnigiri(`<span>{{ message }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("expression", () => {
        const result = compileOnigiri(`<span>{{ count + 1 }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("method call", () => {
        const result = compileOnigiri(`<span>{{ formatDate(date) }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("ternary", () => {
        const result = compileOnigiri(`<span>{{ active ? 'Yes' : 'No' }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("mixed text and interpolation", () => {
        const result = compileOnigiri(`<p>Hello {{ name }}, you have {{ count }} messages.</p>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("dynamic bindings", () => {
      it("v-bind shorthand", () => {
        const result = compileOnigiri(`<div :id="elementId" :class="dynamicClass">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("v-bind object spread", () => {
        const result = compileOnigiri(`<div v-bind="attrs">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("dynamic attribute name", () => {
        const result = compileOnigiri(`<div :[attrName]="attrValue">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("class object binding", () => {
        const result = compileOnigiri(
          `<div :class="{ active: isActive, disabled: isDisabled }">Content</div>`,
        );
        expect(result.code).toMatchSnapshot();
      });

      it("class array binding", () => {
        const result = compileOnigiri(`<div :class="[baseClass, conditionalClass]">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("style object binding", () => {
        const result = compileOnigiri(
          `<div :style="{ color: textColor, fontSize: size + 'px' }">Content</div>`,
        );
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("event handlers", () => {
      it("simple click handler", () => {
        const result = compileOnigiri(`<button @click="handleClick">Click me</button>`);
        expect(result.code).toMatchSnapshot();
      });

      it("handler with modifier", () => {
        const result = compileOnigiri(`<form @submit.prevent="onSubmit">Submit</form>`);
        expect(result.code).toMatchSnapshot();
      });

      it("inline expression handler", () => {
        const result = compileOnigiri(`<button @click="count++">Increment</button>`);
        expect(result.code).toMatchSnapshot();
      });

      it("multiple event handlers", () => {
        const result = compileOnigiri(`<input @focus="onFocus" @blur="onBlur" @input="onInput" />`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("directives", () => {
      it("v-if", () => {
        const result = compileOnigiri(`<div v-if="show">Conditional</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("v-else-if and v-else", () => {
        const result = compileOnigiri(`
          <div v-if="status === 'loading'">Loading...</div>
          <div v-else-if="status === 'error'">Error!</div>
          <div v-else>Content</div>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("v-for with key", () => {
        const result = compileOnigiri(
          `<li v-for="item in items" :key="item.id">{{ item.name }}</li>`,
        );
        expect(result.code).toMatchSnapshot();
      });

      it("v-for with index", () => {
        const result = compileOnigiri(
          `<li v-for="(item, index) in items" :key="index">{{ index }}: {{ item }}</li>`,
        );
        expect(result.code).toMatchSnapshot();
      });

      it("v-if branch with a single v-for child emits valid JS", () => {
        const result = compileOnigiri(`
          <template v-if="show">
            <li v-for="item in items" :key="item">{{ item }}</li>
          </template>
        `);

        expect(result.code).not.toMatch(/\?\s*\.\.\.\(/);
        expect(result.code).toContain("? [3, [");
      });

      it("nested v-for body containing only v-for emits valid JS", () => {
        const result = compileOnigiri(`
          <template v-for="group in groups" :key="group.id">
            <li v-for="item in group.items" :key="item">{{ item }}</li>
          </template>
        `);

        expect(result.code).not.toMatch(/=>\s*\.\.\.\(/);
        expect(result.code).toContain("=> [3, [");
      });

      it("v-else branch with a single v-for child emits valid JS", () => {
        const result = compileOnigiri(`
          <template v-if="show">
            <div>shown</div>
          </template>
          <template v-else>
            <li v-for="item in items" :key="item">{{ item }}</li>
          </template>
        `);

        expect(result.code).not.toMatch(/:\s*\.\.\.\(/);
        expect(result.code).toContain(": [3, [");
      });

      it("v-show", () => {
        const result = compileOnigiri(`<div v-show="visible">Visible content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("v-model on input", () => {
        const result = compileOnigiri(`<input v-model="text" />`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("components", () => {
      const additionalImports = new Map([
        ["MyComponent", { path: "/components/MyComponent.vue" }],
        ["MyList", { path: "/components/MyList.vue" }],
      ]);

      it("component with props", () => {
        const result = compileOnigiri(`<MyComponent v-load-client :title="title" :count="42" />`, {
          additionalImports,
        });
        expect(result.code).toMatchSnapshot();
      });

      it("component with default slot", () => {
        const result = compileOnigiri(
          `<MyComponent v-load-client>Default slot content</MyComponent>`,
          { additionalImports },
        );
        expect(result.code).toMatchSnapshot();
      });

      it("component with named slots", () => {
        const result = compileOnigiri(
          `
          <MyComponent v-load-client>
            <template #header>Header content</template>
            <template #default>Main content</template>
            <template #footer>Footer content</template>
          </MyComponent>
        `,
          { additionalImports },
        );
        expect(result.code).toMatchSnapshot();
      });

      it("scoped slot on client-loaded component throws", () => {
        expect(() =>
          compileOnigiri(
            `
          <MyList v-load-client :items="items">
            <template #item="{ item, index }">
              <span>{{ index }}: {{ item.name }}</span>
            </template>
          </MyList>
        `,
            { additionalImports },
          ),
        ).toThrow(/Scoped slots are not supported on client-loaded components/);
      });

      it("kebab-case component with v-load-client", () => {
        const result = compileOnigiri(
          `<my-component v-load-client :prop="value">Content</my-component>`,
          { additionalImports },
        );
        expect(result.code).toMatchSnapshot();
      });

      it("component WITHOUT v-load-client (server-rendered)", () => {
        const result = compileOnigiri(`<MyComponent :title="title" :count="42" />`);
        expect(result.code).toMatchSnapshot();
      });

      it("component WITHOUT v-load-client with slot", () => {
        const result = compileOnigiri(`<MyComponent>Slot content</MyComponent>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("slots", () => {
      it("default slot outlet", () => {
        const result = compileOnigiri(`<slot></slot>`);
        expect(result.code).toMatchSnapshot();
      });

      it("named slot outlet", () => {
        const result = compileOnigiri(`<slot name="header"></slot>`);
        expect(result.code).toMatchSnapshot();
      });

      it("slot with fallback", () => {
        const result = compileOnigiri(`<slot>Fallback content</slot>`);
        expect(result.code).toMatchSnapshot();
      });

      it("scoped slot outlet", () => {
        const result = compileOnigiri(`<slot :item="item" :index="index"></slot>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("inline expressions", () => {
      it("simple element", () => {
        const result = compileOnigiriInline(`<div>Hello</div>`);
        expect(result.expression).toMatchSnapshot();
      });

      it("element with interpolation", () => {
        const result = compileOnigiriInline(`<span>{{ message }}</span>`);
        expect(result.expression).toMatchSnapshot();
      });

      it("component with v-load-client", () => {
        const result = compileOnigiriInline(`<Counter v-load-client :initial="5" />`, {
          additionalImports: new Map([["Counter", { path: "/components/Counter.vue" }]]),
        });
        expect(result.expression).toMatchSnapshot();
      });

      it("component without v-load-client (server-rendered)", () => {
        const result = compileOnigiriInline(`<Counter :initial="5" />`);
        expect(result.expression).toMatchSnapshot();
      });

      it("fragment", () => {
        const result = compileOnigiriInline(`<div>A</div><div>B</div>`);
        expect(result.expression).toMatchSnapshot();
      });

      it("complex nested structure", () => {
        const result = compileOnigiriInline(`
          <div class="card">
            <header class="card-header">
              <h2>{{ title }}</h2>
            </header>
            <div class="card-body">
              <p>{{ content }}</p>
            </div>
          </div>
        `);
        expect(result.expression).toMatchSnapshot();
      });
    });

    describe("real-world examples", () => {
      it("todo item", () => {
        const result = compileOnigiri(`
          <li class="todo-item" :class="{ completed: todo.done }">
            <input type="checkbox" :checked="todo.done" @change="toggle(todo.id)" />
            <span>{{ todo.text }}</span>
            <button @click="remove(todo.id)">×</button>
          </li>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("navigation menu", () => {
        const result = compileOnigiri(`
          <nav class="navbar">
            <a href="/" class="logo">MyApp</a>
            <ul class="nav-links">
              <li v-for="link in links" :key="link.path">
                <a :href="link.path" :class="{ active: currentPath === link.path }">
                  {{ link.label }}
                </a>
              </li>
            </ul>
          </nav>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("form with validation", () => {
        const result = compileOnigiri(`
          <form @submit.prevent="onSubmit" class="form">
            <div class="form-group">
              <label for="email">Email</label>
              <input 
                id="email" 
                type="email" 
                v-model="email" 
                :class="{ error: errors.email }"
              />
              <span v-if="errors.email" class="error-message">{{ errors.email }}</span>
            </div>
            <button type="submit" :disabled="isSubmitting">
              {{ isSubmitting ? 'Submitting...' : 'Submit' }}
            </button>
          </form>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("card component", () => {
        const result = compileOnigiri(`
          <article class="card" :class="[variant, { featured: isFeatured }]">
            <img v-if="image" :src="image" :alt="title" class="card-image" />
            <div class="card-content">
              <h3 class="card-title">{{ title }}</h3>
              <p class="card-description">{{ description }}</p>
              <slot name="actions"></slot>
            </div>
          </article>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("modal dialog", () => {
        const result = compileOnigiri(`
          <div v-if="isOpen" class="modal-overlay" @click.self="close">
            <div class="modal" role="dialog" :aria-labelledby="titleId">
              <header class="modal-header">
                <h2 :id="titleId">{{ title }}</h2>
                <button @click="close" aria-label="Close">×</button>
              </header>
              <div class="modal-body">
                <slot></slot>
              </div>
              <footer class="modal-footer">
                <slot name="footer">
                  <button @click="close">Close</button>
                </slot>
              </footer>
            </div>
          </div>
        `);
        expect(result.code).toMatchSnapshot();
      });
    });
  });
});
