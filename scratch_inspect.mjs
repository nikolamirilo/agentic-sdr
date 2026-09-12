import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle0" });

const info = await page.evaluate(() => {
  const header = document.querySelector("header > div");
  const link = header.querySelector('a[href="/admin"]');
  const button = link.querySelector("button");
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
  };
  return {
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    header: rect(header),
    link: rect(link),
    button: rect(button),
    buttonText: button.textContent,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/puppeteer_header.png", clip: { x: 0, y: 0, width: 390, height: 80 } });
await browser.close();
