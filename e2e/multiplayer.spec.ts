import { expect, test } from '@playwright/test'

test('two browser contexts join the same room, see roster, move, and exchange chat', async ({
                                                                                                browser,
                                                                                            }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    await pageA.goto('/')
    await pageB.goto('/')

    await pageA.fill('#pilot-callsign', 'PILOT-ALPHA')
    await pageA.click('#join-room-btn')

    await pageB.fill('#pilot-callsign', 'PILOT-BRAVO')
    await pageB.click('#join-room-btn')

    await expect(pageA.locator('#roster-list')).toContainText('PILOT-ALPHA', { timeout: 8000 })
    await expect(pageA.locator('#roster-list')).toContainText('PILOT-BRAVO', { timeout: 8000 })
    await expect(pageB.locator('#roster-list')).toContainText('PILOT-ALPHA', { timeout: 8000 })

    await pageA.keyboard.down('KeyW')
    await pageA.waitForTimeout(450)
    await pageA.keyboard.up('KeyW')

    await pageA.fill('#chat-input', 'Fox Two from Alpha!')
    await pageA.click('#chat-form button[type="submit"]')

    await expect(pageB.locator('#chat-log')).toContainText('Fox Two from Alpha!', { timeout: 5000 })

    await ctxA.close()
    await ctxB.close()
})