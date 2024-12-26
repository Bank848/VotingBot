const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config.json'); // จำเป็นต้องมี token และ clientId ของบอท

// สร้าง client ใหม่พร้อมเปิดใช้งาน Intents ที่จำเป็น
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // ใช้เพื่อเข้าถึงข้อมูลเกี่ยวกับเซิร์ฟเวอร์
  ]
});

// ลงทะเบียน Slash Command
const commands = [
  {
    name: 'hello',
    description: 'Say hello!',
  },
  {
    name: 'vote',
    description: 'Cast your vote!',
  },
];

// ลงทะเบียนคำสั่งใน Discord
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

// เมื่อบอทออนไลน์
client.once('ready', () => {
  console.log('Bot is online!');
});

// รับคำสั่ง Slash Command
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'hello') {
    await interaction.reply('Hello, I am your bot!');
  } else if (commandName === 'vote') {
    await interaction.reply('Please cast your vote using the link!');
  }
});

// เข้าสู่ระบบด้วย token ของบอท
client.login(token);
