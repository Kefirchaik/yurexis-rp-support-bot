import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Bot, InlineKeyboard } from "grammy";
import { db } from "../lib/db";

const token = process.env.BOT_TOKEN;
const ownerId = Number(process.env.OWNER_ID);
if (!token) throw new Error("BOT_TOKEN is missing");
if (!ownerId) throw new Error("OWNER_ID is missing");
const bot = new Bot(token);

type Ticket = {
  id: number; user_id: number; username: string | null; display_name: string;
  status: "open" | "closed"; assigned_to: number | null; created_at?: string;
};
type Staff = { telegram_id: number; username?: string | null; display_name?: string; role: string };

const menu = () => new InlineKeyboard()
  .text("🎫 Создать обращение", "ticket:create").row()
  .text("📂 Мои обращения", "ticket:list").text("💎 О проекте", "about");
const staffMenu = () => new InlineKeyboard()
  .text("📥 Открытые заявки", "staff:open").row()
  .text("📊 Статистика", "staff:stats").text("⚙️ Управление", "staff:manage");
const ticketButtons = (id: number, status: string) => new InlineKeyboard()
  .text("💬 Ответить", `staff:reply:${id}`)
  .text(status === "open" ? "🔒 Закрыть" : "🔓 Уже закрыта", `staff:close:${id}`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const display = (u: { id: number; username?: string; first_name?: string; last_name?: string }) =>
  `${[u.first_name, u.last_name].filter(Boolean).join(" ") || "Без имени"}${u.username ? ` (@${u.username})` : ""} · ID ${u.id}`;

async function isStaff(id: number) {
  if (id === ownerId) return true;
  const rows = await db<Staff[]>("staff", "GET", `?telegram_id=eq.${id}&select=telegram_id&limit=1`);
  return rows.length > 0;
}
async function staffList() {
  const rows = await db<Staff[]>("staff", "GET", "?select=telegram_id,username,display_name,role");
  return [{ telegram_id: ownerId, role: "owner", display_name: "Владелец" } as Staff, ...rows.filter(x => x.telegram_id !== ownerId)];
}
async function getTicket(id: number) {
  const rows = await db<Ticket[]>("tickets", "GET", `?id=eq.${id}&select=*&limit=1`);
  return rows[0];
}
async function getOpenTicket(userId: number) {
  const rows = await db<Ticket[]>("tickets", "GET", `?user_id=eq.${userId}&status=eq.open&select=*&order=id.desc&limit=1`);
  return rows[0];
}
async function logMessage(ticketId: number, senderId: number, role: "user" | "staff" | "system", type = "message") {
  await db("ticket_messages", "POST", "", { ticket_id: ticketId, sender_id: senderId, sender_role: role, message_type: type });
}
async function setSession(staffId: number, ticketId: number) {
  await db("staff_sessions", "POST", "?on_conflict=staff_id", { staff_id: staffId, ticket_id: ticketId }, "resolution=merge-duplicates,return=representation");
}
async function getSession(staffId: number) {
  const rows = await db<{ staff_id: number; ticket_id: number }[]>("staff_sessions", "GET", `?staff_id=eq.${staffId}&select=*&limit=1`);
  return rows[0];
}
async function clearSession(staffId: number) {
  await db("staff_sessions", "DELETE", `?staff_id=eq.${staffId}`, undefined, "return=minimal");
}
async function notifyStaff(ticket: Ticket, userInfo: string) {
  const staff = await staffList();
  const text = `✨ <b>НОВАЯ ЗАЯВКА #${ticket.id}</b>\n━━━━━━━━━━━━━━\n👤 ${esc(userInfo)}\n🟢 Статус: открыта\n\nНажмите «Ответить», чтобы открыть режим ответа. Ваши следующие сообщения будут отправляться пользователю до завершения режима.`;
  await Promise.allSettled(staff.map(async person => {
    try { await bot.api.sendMessage(person.telegram_id, text, { parse_mode: "HTML", reply_markup: ticketButtons(ticket.id, ticket.status) }); }
    catch (e) { console.warn(`Could not notify staff ${person.telegram_id}; they may need to /start the bot.`, e); }
  }));
}

bot.command("start", async ctx => {
  if (ctx.chat.type !== "private" || !ctx.from) return;
  const staff = await isStaff(ctx.from.id);
  const greeting = `✨ <b>YUREXIS RP</b>\n<tg-spoiler>SUPPORT CENTER</tg-spoiler>\n━━━━━━━━━━━━━━━━━━\nДобро пожаловать в официальную техническую поддержку проекта!\n\n🎮 Поможем с вопросами по игре, аккаунту и работе проекта.\n📩 Создай обращение, опиши проблему и дождись ответа команды.\n\nВыбери действие в меню ниже 👇`;
  await ctx.reply(greeting, { parse_mode: "HTML", reply_markup: staff ? staffMenu() : menu() });
});

bot.command("id", async ctx => {
  if (!ctx.from) return;
  await ctx.reply(`🪪 Твой Telegram ID: <code>${ctx.from.id}</code>`, { parse_mode: "HTML" });
});
bot.command("help", async ctx => {
  if (!ctx.from) return;
  const staff = await isStaff(ctx.from.id);
  await ctx.reply(staff
    ? "🛠 <b>Панель персонала</b>\n\n/start — открыть меню\n/id — узнать Telegram ID\n/grant ID — выдать права (владелец)\n/revoke ID — снять права (владелец)\n\nДля ответа нажми «Ответить» в карточке заявки, затем отправляй сообщения. /stopreply завершает режим ответа."
    : "ℹ️ <b>Как работает поддержка</b>\n\n1. Нажми «Создать обращение».\n2. Опиши вопрос одним или несколькими сообщениями.\n3. Оператор ответит в этом чате.\n\n/start — главное меню", { parse_mode: "HTML", reply_markup: staff ? staffMenu() : menu() });
});

bot.callbackQuery("about", async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.reply("💎 <b>YUREXIS RP SUPPORT</b>\n\nОфициальный центр поддержки проекта YUREXIS RP.\nПожалуйста, не отправляй пароли и коды подтверждения.", { parse_mode: "HTML", reply_markup: menu() });
});
bot.callbackQuery("ticket:create", async ctx => {
  await ctx.answerCallbackQuery();
  if (ctx.chat?.type !== "private") return;
  const existing = await getOpenTicket(ctx.from.id);
  if (existing) {
    await ctx.reply(`📂 У тебя уже есть открытое обращение <b>#${existing.id}</b>. Просто отправь сообщение сюда — оно попадёт оператору.`, { parse_mode: "HTML", reply_markup: menu() });
    return;
  }
  const rows = await db<Ticket[]>("tickets", "POST", "", {
    user_id: ctx.from.id, username: ctx.from.username ?? null,
    display_name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Без имени",
    status: "open", assigned_to: null
  });
  const ticket = rows[0];
  await logMessage(ticket.id, ctx.from.id, "system", "created");
  await notifyStaff(ticket, display(ctx.from));
  await ctx.reply(`✅ <b>Обращение #${ticket.id} создано!</b>\n\nТеперь напиши, что случилось. Можешь отправлять текст, фото и документы — команда получит сообщения и ответит здесь.\n\n<i>Ожидай ответа оператора.</i>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("📂 Мои обращения", "ticket:list").text("❌ Отмена", `ticket:cancel:${ticket.id}`) });
});
bot.callbackQuery("ticket:list", async ctx => {
  await ctx.answerCallbackQuery();
  const rows = await db<Ticket[]>("tickets", "GET", `?user_id=eq.${ctx.from.id}&select=*&order=id.desc&limit=10`);
  if (!rows.length) { await ctx.reply("📭 У тебя пока нет обращений.", { reply_markup: menu() }); return; }
  const text = "📂 <b>Твои обращения</b>\n\n" + rows.map(t => `${t.status === "open" ? "🟢" : "🔒"} <b>#${t.id}</b> — ${t.status === "open" ? "Открыто" : "Закрыто"}`).join("\n");
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: menu() });
});
bot.callbackQuery(/^ticket:cancel:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const ticket = await getTicket(id);
  if (!ticket || ticket.user_id !== ctx.from.id || ticket.status !== "open") { await ctx.reply("Не удалось отменить это обращение."); return; }
  await db("tickets", "PATCH", `?id=eq.${id}`, { status: "closed", closed_at: new Date().toISOString() });
  await logMessage(id, ctx.from.id, "system", "cancelled");
  await ctx.reply(`🔒 Обращение #${id} закрыто. Если понадобится помощь, создай новое.`, { reply_markup: menu() });
});

bot.callbackQuery("staff:open", async ctx => {
  await ctx.answerCallbackQuery();
  if (!(await isStaff(ctx.from.id))) { await ctx.reply("⛔ Нет доступа."); return; }
  const rows = await db<Ticket[]>("tickets", "GET", "?status=eq.open&select=*&order=id.asc&limit=20");
  if (!rows.length) { await ctx.reply("🎉 Открытых заявок пока нет.", { reply_markup: staffMenu() }); return; }
  await ctx.reply(`📥 <b>Открытые заявки (${rows.length})</b>\nВыбери заявку для ответа:`, { parse_mode: "HTML" });
  for (const t of rows) {
    await ctx.reply(`🎫 <b>Заявка #${t.id}</b>\n👤 ${esc(t.display_name)}${t.username ? ` (@${esc(t.username)})` : ""}\n🆔 <code>${t.user_id}</code>\nСтатус: 🟢 Открыта`, { parse_mode: "HTML", reply_markup: ticketButtons(t.id, t.status) });
  }
});
bot.callbackQuery("staff:stats", async ctx => {
  await ctx.answerCallbackQuery();
  if (!(await isStaff(ctx.from.id))) { await ctx.reply("⛔ Нет доступа."); return; }
  const rows = await db<Ticket[]>("tickets", "GET", "?select=id,status");
  await ctx.reply(`📊 <b>YUREXIS RP — статистика</b>\n━━━━━━━━━━━━━━\n🎫 Всего обращений: <b>${rows.length}</b>\n🟢 Открыто: <b>${rows.filter(t => t.status === "open").length}</b>\n🔒 Закрыто: <b>${rows.filter(t => t.status === "closed").length}</b>`, { parse_mode: "HTML", reply_markup: staffMenu() });
});
bot.callbackQuery("staff:manage", async ctx => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ownerId) { await ctx.reply("🔐 Управление персоналом доступно только владельцу."); return; }
  const staff = await staffList();
  await ctx.reply(`⚙️ <b>Управление персоналом</b>\n━━━━━━━━━━━━━━\n${staff.map(s => `• ${esc(s.display_name || "Оператор")} — <code>${s.telegram_id}</code> (${s.role})`).join("\n")}\n\nЧтобы выдать доступ: <code>/grant TELEGRAM_ID</code>\nЧтобы снять доступ: <code>/revoke TELEGRAM_ID</code>\n\nНовый оператор должен сначала нажать /start у бота.`, { parse_mode: "HTML", reply_markup: staffMenu() });
});
bot.callbackQuery(/^staff:reply:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  if (!(await isStaff(ctx.from.id))) { await ctx.reply("⛔ Нет доступа к заявкам."); return; }
  const id = Number(ctx.match[1]);
  const ticket = await getTicket(id);
  if (!ticket || ticket.status !== "open") { await ctx.reply("Эта заявка уже закрыта или не найдена."); return; }
  await setSession(ctx.from.id, id);
  await db("tickets", "PATCH", `?id=eq.${id}`, { assigned_to: ctx.from.id });
  await ctx.reply(`💬 <b>Режим ответа включён · заявка #${id}</b>\n\nТеперь отправляй сообщения, фото или документы в этот чат — они будут доставлены пользователю.\n\nКогда закончишь, нажми кнопку ниже.`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("⏹ Завершить ответ", "staff:stopreply").text("🔒 Закрыть заявку", `staff:close:${id}`) });
});
bot.callbackQuery("staff:stopreply", async ctx => {
  await ctx.answerCallbackQuery(); await clearSession(ctx.from.id);
  await ctx.reply("⏹ Режим ответа завершён. Сообщения больше не будут пересылаться пользователю.", { reply_markup: staffMenu() });
});
bot.callbackQuery(/^staff:close:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  if (!(await isStaff(ctx.from.id))) { await ctx.reply("⛔ Нет доступа."); return; }
  const id = Number(ctx.match[1]); const ticket = await getTicket(id);
  if (!ticket || ticket.status === "closed") { await ctx.reply("Заявка уже закрыта или не найдена."); return; }
  await db("tickets", "PATCH", `?id=eq.${id}`, { status: "closed", closed_at: new Date().toISOString() });
  await logMessage(id, ctx.from.id, "system", "closed");
  await bot.api.sendMessage(ticket.user_id, `🔒 <b>Обращение #${id} закрыто.</b>\nСпасибо, что обратился в YUREXIS RP. Если понадобится помощь, создай новое обращение.`, { parse_mode: "HTML", reply_markup: menu() });
  const session = await getSession(ctx.from.id); if (session?.ticket_id === id) await clearSession(ctx.from.id);
  await ctx.reply(`🔒 Обращение #${id} закрыто.`, { reply_markup: staffMenu() });
});

bot.command("grant", async ctx => {
  if (ctx.chat.type !== "private" || !ctx.from || ctx.from.id !== ownerId) { await ctx.reply("🔐 Эта команда доступна только владельцу в личном чате с ботом."); return; }
  const id = Number(ctx.match?.trim());
  if (!Number.isSafeInteger(id) || id <= 0) { await ctx.reply("Использование: <code>/grant TELEGRAM_ID</code>\nОператор должен сначала нажать /start у бота.", { parse_mode: "HTML" }); return; }
  if (id === ownerId) { await ctx.reply("У владельца уже есть полный доступ."); return; }
  await db("staff", "POST", "?on_conflict=telegram_id", { telegram_id: id, username: null, display_name: `Оператор ${id}`, role: "operator", added_by: ownerId }, "resolution=merge-duplicates,return=representation");
  await ctx.reply(`✅ Пользователю <code>${id}</code> выданы права оператора.`, { parse_mode: "HTML" });
  try { await bot.api.sendMessage(id, "🛡 Тебе выданы права оператора YUREXIS RP! Нажми /start, чтобы открыть панель персонала.", { reply_markup: staffMenu() }); } catch {}
});
bot.command("revoke", async ctx => {
  if (ctx.chat.type !== "private" || !ctx.from || ctx.from.id !== ownerId) { await ctx.reply("🔐 Эта команда доступна только владельцу в личном чате с ботом."); return; }
  const id = Number(ctx.match?.trim());
  if (!Number.isSafeInteger(id) || id <= 0 || id === ownerId) { await ctx.reply("Использование: <code>/revoke TELEGRAM_ID</code>", { parse_mode: "HTML" }); return; }
  await db("staff", "DELETE", `?telegram_id=eq.${id}`, undefined, "return=minimal");
  await clearSession(id);
  await ctx.reply(`🗑 Права оператора у пользователя <code>${id}</code> отозваны.`, { parse_mode: "HTML" });
  try { await bot.api.sendMessage(id, "ℹ️ Твои права оператора YUREXIS RP были отозваны.", { reply_markup: menu() }); } catch {}
});
bot.command("stopreply", async ctx => {
  if (!ctx.from) return;
  if (await isStaff(ctx.from.id)) {
    await clearSession(ctx.from.id);
    await ctx.reply("⏹ Режим ответа завершён.", { reply_markup: staffMenu() });
  }
});

bot.on("message", async ctx => {
  const msg = ctx.message;
  if (msg.text?.startsWith("/")) return;
  if (ctx.chat.type !== "private") return;
  const id = ctx.from.id;
  if (await isStaff(id)) {
    const session = await getSession(id);
    if (session) {
      const ticket = await getTicket(session.ticket_id);
      if (!ticket || ticket.status !== "open") { await clearSession(id); await ctx.reply("Эта заявка уже закрыта. Режим ответа завершён.", { reply_markup: staffMenu() }); return; }
      try {
        await bot.api.copyMessage(ticket.user_id, ctx.chat.id, msg.message_id);
        await logMessage(ticket.id, id, "staff", msg.photo || msg.document ? "media" : "message");
        await ctx.reply(`✅ Доставлено пользователю · заявка #${ticket.id}`, { reply_markup: new InlineKeyboard().text("⏹ Завершить ответ", "staff:stopreply").text("🔒 Закрыть заявку", `staff:close:${ticket.id}`) });
      } catch (e) { console.error(e); await ctx.reply("❌ Не удалось отправить сообщение пользователю. Возможно, он не запускал бота."); }
      return;
    }
    // Staff can still use customer support for themselves only after explicitly creating a ticket.
    return;
  }
  const ticket = await getOpenTicket(id);
  if (!ticket) { await ctx.reply("Сначала создай обращение в меню ниже 👇", { reply_markup: menu() }); return; }
  try {
    const staff = await staffList();
    const caption = `📨 <b>Сообщение по заявке #${ticket.id}</b>\n👤 ${esc(display(ctx.from))}`;
    await Promise.allSettled(staff.map(async person => {
      try {
        await bot.api.sendMessage(person.telegram_id, caption, { parse_mode: "HTML", reply_markup: ticketButtons(ticket.id, ticket.status) });
        await bot.api.copyMessage(person.telegram_id, ctx.chat.id, msg.message_id);
      } catch (e) { console.warn(`Could not deliver ticket update to ${person.telegram_id}`, e); }
    }));
    await logMessage(ticket.id, id, "user", msg.photo || msg.document ? "media" : "message");
    await ctx.reply("📨 Сообщение передано команде поддержки. Ожидай ответа здесь.");
  } catch (e) { console.error(e); await ctx.reply("Не удалось передать сообщение. Попробуй ещё раз позже."); }
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(200).send("YUREXIS RP Support Bot is running.");
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(401).send("Unauthorized");
  try { await bot.handleUpdate(req.body); return res.status(200).send("OK"); }
  catch (error) { console.error("Webhook error", error); return res.status(500).send("Webhook error"); }
    }
  
