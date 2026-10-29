import { test, expect } from "@playwright/test";
test.skip(!process.env.LIVE_E2E,"requires the local Durable Object service");
test("two guests join, share state, transfer host, enable drawing, and travel",async({browser})=>{
  const hostContext=await browser.newContext(),guestContext=await browser.newContext();const host=await hostContext.newPage(),guest=await guestContext.newPage();
  await host.goto("/#/play");await host.getByLabel("Display name").fill("Host");await host.getByRole("button",{name:/Mara the Wayfarer/}).click();await host.getByLabel("Starting Thing").selectOption("published:emberheart-tavern");await host.getByRole("button",{name:"Create live room"}).click();await expect(host.getByText(/LIVE · TEMPORARY ROOM/)).toBeVisible();const invitation=await host.getByLabel("Invitation link").inputValue();expect(invitation).toContain("#/play/");
  await guest.goto(invitation);await guest.getByLabel("Display name").fill("Guest");await guest.getByRole("button",{name:/Mara the Wayfarer/}).click();await guest.getByRole("button",{name:"Join room"}).click();await expect(guest.getByText(/LIVE · TEMPORARY ROOM/)).toBeVisible();await expect(host.getByRole("button",{name:/Guest · Mara/})).toBeVisible();
  const guestRow=host.locator(".participant-row").filter({hasText:"Guest · Mara"});await guestRow.getByRole("button",{name:"Make host"}).click();await expect(guest.getByRole("button",{name:"Enable drawing"})).toBeVisible();await guest.getByRole("button",{name:"Enable drawing"}).click();await expect(host.getByRole("button",{name:"Draw"})).toBeVisible();
  const basement=guest.locator(".play-link").filter({hasText:"Stairs to Basement"});await basement.getByRole("button",{name:"Travel"}).click();await expect(host.getByText("PARTY AT Emberheart Basement")).toBeVisible();await expect(guest.getByText("PARTY AT Emberheart Basement")).toBeVisible();
  await hostContext.close();await guestContext.close();
});
