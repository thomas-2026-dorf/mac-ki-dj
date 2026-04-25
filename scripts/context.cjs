const fs = require("fs");
const path = require("path");

function log(title, content) {
    console.log("\n=== " + title + " ===");
    console.log(content);
}

function listDir(dir, prefix = "") {
    if (!fs.existsSync(dir)) return "Ordner nicht gefunden";

    return fs
        .readdirSync(dir)
        .filter((item) => !["node_modules", ".git", "target", "dist"].includes(item))
        .map((item) => {
            const full = path.join(dir, item);
            if (fs.statSync(full).isDirectory()) {
                return prefix + item + "/\n" + listDir(full, prefix + "  ");
            }
            return prefix + item;
        })
        .join("\n");
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));

log("TK-DJ CONTEXT", "Projektübersicht");
log("Name", pkg.name);
log("Version", pkg.version);
log("Scripts", Object.keys(pkg.scripts).join(", "));
log("STRUKTUR (src)", listDir("src"));