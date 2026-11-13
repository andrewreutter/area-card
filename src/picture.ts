/** Cover image shared by the collapsed button and the expanded popup. */
export function pictureBackgroundStyles(picture: string, surface: "button" | "popup"): string {
  const url = JSON.stringify(picture);
  if (surface === "button") {
    return [
      ".bubble-background {",
      `  background-image: linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.28)), url(${url});`,
      "  background-size: cover;",
      "  background-position: center;",
      "}",
      ".bubble-name,",
      ".bubble-state {",
      "  color: #fff !important;",
      "  text-shadow: 0 1px 2px rgba(0,0,0,.65);",
      "}",
    ].join("\n");
  }
  return [
    ".bubble-pop-up-background {",
    `  background-image: linear-gradient(to bottom, rgba(0,0,0,.55), rgba(0,0,0,.28)), url(${url});`,
    "  background-size: 100% auto;",
    "  background-position: top center;",
    "  background-repeat: no-repeat;",
    "}",
  ].join("\n");
}
