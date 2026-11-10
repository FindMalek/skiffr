import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Skiffr",
    description: "Skiffr for your browser",
    permissions: ["storage", "activeTab"],
    commands: {
      fill: {
        suggested_key: { default: "Ctrl+Shift+F", mac: "Command+Shift+F" },
        description: "Fill the focused page",
      },
    },
  },
})
