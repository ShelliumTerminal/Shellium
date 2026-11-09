// Keeps everything that names the version in step with package.json. Run by npm's version hooks:
//   preversion: `--check`  - refuses to release when CHANGELOG.md has nothing under "Unreleased".
//   version:    (no flag)  - after the bump: the Unreleased notes become "## [x.y.z] - date". When the
//               website repository is checked out next to this one (../shellium-website, or the folder
//               in SHELLIUM_WEBSITE), its RELEASE.version and file names change to the new version too;
//               commit that in the website repository.
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, text) => fs.writeFileSync(path.join(root, file), text);

const changelogFile = "CHANGELOG.md";
const changelog = read(changelogFile);
const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[)/m.exec(changelog);

if (process.argv.includes("--check")) {
  if (!unreleased || !unreleased[1].trim()) {
    console.error("CHANGELOG.md: nothing under \"## [Unreleased]\". Describe the release there first.");
    process.exit(1);
  }
  process.exit(0);
}

const version = JSON.parse(read("package.json")).version;
const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

if (!changelog.includes(`## [${version}]`)) {
  write(changelogFile, changelog.replace(/^## \[Unreleased\][^\n]*\n\n?/m, `## [Unreleased]\n\n## [${version}] - ${date}\n\n`));
}

const website = path.resolve(root, process.env.SHELLIUM_WEBSITE || "../shellium-website");
const siteJs = path.join(website, "assets/js/site.js");
const siteHtml = path.join(website, "index.html");
let previous;
if (fs.existsSync(siteJs) && fs.existsSync(siteHtml)) {
  const js = fs.readFileSync(siteJs, "utf8");
  previous = /version: "(\d+\.\d+\.\d+)"/.exec(js)?.[1];
  if (previous && previous !== version) {
    fs.writeFileSync(siteJs, js.replace(`version: "${previous}"`, `version: "${version}"`));
    fs.writeFileSync(siteHtml, fs.readFileSync(siteHtml, "utf8").split(previous).join(version));
  }
} else {
  console.log(`website not found at ${website} - its version is not changed`);
}
console.log(`version ${version}${previous && previous !== version ? ` (website ${previous} -> ${version})` : ""}, changelog dated ${date}`);
