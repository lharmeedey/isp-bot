const store = require('../data/store');

const awaitingEmail = new Set();
const awaitingName  = new Map();

function startRegistration(ctx) {
  return (async () => {
    const existing = await store.getUserByTelegramId(ctx.from.id);
    if (existing) {
      return ctx.replyWithMarkdown(`You're already registered as *${existing.name}* (${existing.email}).\n\nUse /balance to check your data.`);
    }
    awaitingEmail.add(ctx.from.id);
    return ctx.reply('Please enter your email address (e.g. you@example.com):');
  })();
}

async function handleText(ctx, next) {
  const tid  = ctx.from.id;
  const text = ctx.message.text.trim();

  // ── Step 1: waiting for email ──
  if (awaitingEmail.has(tid)) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(text)) {
      return ctx.reply('That doesn\'t look like a valid email. Try again (e.g. you@example.com):');
    }

    const email = text.toLowerCase();
    const existing = await store.getUserByEmail(email);

    if (existing) {
      awaitingEmail.delete(tid);
      return ctx.reply('That email is already registered. If this is yours, contact /support.');
    }

    awaitingEmail.delete(tid);
    awaitingName.set(tid, email);
    return ctx.reply(`Got it — ${email}.\n\nNow enter your full name:`);
  }

  // ── Step 2: waiting for name ──
  if (awaitingName.has(tid)) {
    const email = awaitingName.get(tid);
    const name  = text;

    if (name.length < 2) {
      return ctx.reply('Please enter a valid name:');
    }

    await store.registerUser(tid, email, name);
    awaitingName.delete(tid);

    return ctx.replyWithMarkdown(
`✅ *Registration Complete!*

Name:  ${name}
Email: ${email}

You're all set. Use /buy to purchase a plan or /balance to check your account.`
    );
  }

  return next();
}

module.exports = { startRegistration, handleText };