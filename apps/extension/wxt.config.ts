import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Skiffr",
    description: "Skiffr for your browser",
    permissions: ["storage"],
    minimum_chrome_version: "142",
    action: { default_title: "Skiffr" },
    commands: {
      fill: {
        suggested_key: { default: "Ctrl+Shift+F", mac: "Command+Shift+F" },
        description: "Fill the focused page",
      },
    },
  },
})
