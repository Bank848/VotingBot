const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

// ดึงค่าจาก secret
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const adminUserId = process.env.adminUserId;
const adminSetPointUserId = process.env.Admin_setpoint;
const supabaseUrl = process.env.SUPABASE_URL; // URL ของ Supabase
const supabaseKey = process.env.SUPABASE_KEY; // Supabase Key

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let userVotes = {};
let availableCharacters = [];
let botActive = false;

// เชื่อมต่อกับ Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// ฟังก์ชันเชื่อมต่อ Supabase และโหลดข้อมูล
async function connectToSupabase() {
    try {
        console.log('Connected to Supabase');
        await loadDataFromDb(); // โหลดข้อมูลจาก Supabase
    } catch (error) {
        console.error('Error connecting to Supabase:', error);
        process.exit(1);
    }
}

// ฟังก์ชันโหลดข้อมูลจากฐานข้อมูล
async function loadDataFromDb() {
    try {
        // ดึงข้อมูลคะแนนผู้ใช้จาก user_votes
        const { data: userVotesData, error: userVotesError } = await supabase.from('user_votes').select('*');
        if (userVotesError) throw new Error(userVotesError.message);

        // ดึงข้อมูลตัวละครจาก characters
        const { data: charactersData, error: charactersError } = await supabase.from('characters').select('*');
        if (charactersError) throw new Error(charactersError.message);

        // ดึงข้อมูลสถานะบอทจาก bot_status
        const { data: botStatusData, error: botStatusError } = await supabase.from('bot_status').select('*');
        if (botStatusError) throw new Error(botStatusError.message);

        // ดึงข้อมูลคะแนนจาก user_point
        const { data: userPointsData, error: userPointsError } = await supabase.from('user_point').select('*');
        if (userPointsError) throw new Error(userPointsError.message);

        console.log("User votes data:", userVotesData);
        console.log("Characters data:", charactersData);
        console.log("Bot status data:", botStatusData);
        console.log("User points data:", userPointsData);

        // ถ้ามีข้อมูล ตัวละครที่สามารถโหวตได้จะถูกเก็บใน availableCharacters
        availableCharacters = charactersData.filter(character => character.available);
        userVotes = {}; // ดึงข้อมูลจากฐานข้อมูลและเก็บไว้ใน userVotes
        userVotesData.forEach(vote => {
            userVotes[vote.user_id] = { points: vote.points_vote || 0 }; // คะแนนจากคอลัมน์ points_vote
        });

        // หากมีข้อมูลสถานะบอท ให้เก็บไว้ในตัวแปร botStatus
        botActive = botStatusData.length > 0 && botStatusData[0].is_active;

        // เก็บคะแนนจาก user_point
        userPointsData.forEach(point => {
            if (!userVotes[point.user_id]) {
                userVotes[point.user_id] = { points: 0 };
            }
            userVotes[point.user_id].points = point.user_point || 0;
        });

    } catch (error) {
        console.error("Error loading data from database", error);
    }
}


// ฟังก์ชันบันทึกข้อมูลลง Supabase
async function saveDataToDb() {
    try {
        // บันทึกข้อมูลผู้ใช้ (user_point)
        const userPointsArray = Object.entries(userVotes).map(([userId, votes]) => ({
            user_id: userId,
            user_point: votes.points, // เปลี่ยนเป็น user_point
        }));

        await supabase.from('user_point').upsert(userPointsArray); // ใช้ตาราง user_point แทน user_votes

        // อัปเดตข้อมูลตัวละคร (characters)
        const characterVotesArray = availableCharacters.map(character => ({
            character_name: character.character_name, // ตัวละครจากคอลัมน์ character_name
            available: character.available,  // ถ้าอยากให้ตัวละครพร้อมโหวตตั้งค่าเป็น true
            points_characters: character.points_characters, // คอลัมน์ใหม่ที่ใช้เก็บคะแนน
        }));

        await supabase.from('characters').upsert(characterVotesArray);

        console.log("Data saved to Supabase successfully.");
    } catch (error) {
        console.error("Error saving data to Supabase", error);
    }
}

// ฟังก์ชันสำหรับบันทึกสถานะบอท (บันทึกข้อมูลลง Supabase)
async function saveBotStatusToDb(status) {
    try {
        const { error } = await supabase
            .from('bot_status')
            .upsert([
                {
                    id: 1, // Use an integer ID or auto-increment field if that's required
                    is_active: status,
                    last_updated: new Date(),
                },
            ]);

        if (error) {
            throw new Error(error.message);
        }

        console.log('Bot status saved to Supabase successfully.');
    } catch (error) {
        console.error('Error saving bot status to Supabase:', error);
    }
}

// ฟังก์ชันสำหรับอัพเดตคะแนนในตาราง characters
async function saveCharacterPoints(character, points) {
    try {
        const { data: characterData, error: characterError } = await supabase
            .from('characters')
            .select('character_name, available, points_characters') // เปลี่ยนเป็น points_characters
            .eq('character_name', character);

        if (characterError) {
            throw new Error(characterError.message);
        }

        if (!characterData || characterData.length === 0) {
            throw new Error(`Character "${character}" not found in database.`);
        }

        // ตรวจสอบคะแนนเดิม
        const currentPoints = characterData[0].points_characters || 0;  // เปลี่ยนเป็น points_characters
        console.log(`Current points in database: ${currentPoints}`);

        // คำนวณคะแนนใหม่
        const updatedPoints = currentPoints + points;
        console.log(`Updated points: ${updatedPoints}`);

        // อัปเดตคะแนนในฐานข้อมูล
        const { error: updateError } = await supabase
            .from('characters')
            .update({ points_characters: updatedPoints })  // เปลี่ยนเป็น points_characters
            .eq('character_name', character);

        if (updateError) {
            throw new Error(updateError.message);
        }

        console.log(`Character points updated successfully for "${character}". New points: ${updatedPoints}`);
    } catch (error) {
        console.error("Error updating character points:", error);
    }
}

// ลงทะเบียน Slash Command
const commands = [
    {
        name: 'hello',
        description: 'Say hello!',
    },
    {
        name: 'vote',
        description: 'Cast your vote for the character!',
        options: [
            {
                name: 'character',
                type: 3,
                description: 'The character you want to vote for',
                required: true,
                choices: [],
            },
            {
                name: 'points',
                type: 4,
                description: 'The number of points you want to assign to the vote',
                required: true,
            },
        ],
    },
    {
        name: 'setvoteplus',
        description: 'Add points to a user or role',
        options: [
            {
                name: 'target',
                type: 3,
                description: 'Select user or role to set the vote points for (user/role)',
                required: true,
                choices: [
                    { name: 'User', value: 'user' },
                    { name: 'Role', value: 'role' },
                ],
            },
            {
                name: 'user_or_role',
                type: 6, 
                description: 'The user or role to adjust votes for',
                required: true,
            },
            {
                name: 'points',
                type: 4,
                description: 'Points to add',
                required: true,
            },
        ],
    },
    {
        name: 'setvoteminus',
        description: 'Subtract points from a user or role (points will not go below 0)',
        options: [
            {
                name: 'target',
                type: 3,
                description: 'Select user or role to set the vote points for (user/role)',
                required: true,
                choices: [
                    { name: 'User', value: 'user' },
                    { name: 'Role', value: 'role' },
                ],
            },
            {
                name: 'user_or_role',
                type: 6, 
                description: 'The user or role to adjust votes for',
                required: true,
            },
            {
                name: 'points',
                type: 4,
                description: 'Points to subtract',
                required: true,
            },
        ],
    },
    {
        name: 'setcharacters',
        description: 'Set the characters available for voting',
        options: [
            {
                name: 'characters',
                type: 3,
                description: 'Enter a list of characters separated by commas (e.g., Character A, Character B)',
                required: true,
            },
        ],
    },
    {
        name: 'leaderboard',
        description: 'Show the current votes for each user',
    },
    {
        name: 'resetvotes',
        description: 'Reset the votes for all users',
    },
    {
        name: 'active',
        description: 'Activate or deactivate the bot',
    },
    {
        name: 'mypoints',
        description: 'Check your current vote points',
    },
];

const rest = new REST({ version: '10' }).setToken(token);
(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.once('ready', async () => {
    console.log('Bot is online!');
    await connectToSupabase();  // ฟังก์ชันที่โหลดข้อมูลจาก DB
    console.log('Bot data loaded:', userVotes, availableCharacters); // ตรวจสอบข้อมูลที่โหลดมาจากฐานข้อมูล
});

// การจัดการคำสั่ง (Commands)
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, member, user } = interaction;

    try {
        switch(commandName) {
            case 'hello':
                await interaction.reply('Hello, I am your bot!');
                break;
            case 'vote':
                await handleVote(interaction, member, user);
                break;
            case 'active':
                await handleActive(interaction, user);
                break;
            case 'setvoteplus':
                await handleSetVotePlus(interaction, user);
                break;
            case 'setvoteminus':
                await handleSetVoteMinus(interaction, user);
                break;
            case 'setcharacters':
                await handleSetCharacters(interaction, user);
                break;
            case 'mypoints':
                await handleMyPoints(interaction, user);
                break;
            case 'leaderboard':
                await handleLeaderboard(interaction);
                break;
            case 'resetvotes':
                await handleResetVotes(interaction);
                break;
            default:
                await interaction.reply("Unknown command");
        }
    } catch (error) {
        console.error("Error handling interaction:", error);
        await interaction.reply("An error occurred while processing your command. Please try again later.");
    }
});

async function handleLeaderboard(interaction) {
    try {
        // ดึงข้อมูลตัวละครจาก Supabase
        const { data, error } = await supabase
            .from('characters')
            .select('character_name, points_characters')
            .order('points_characters', { ascending: false });

        // ตรวจสอบ error
        if (error) {
            console.error("Error fetching leaderboard data from Supabase:", error);
            await interaction.reply("An error occurred while fetching the leaderboard. Please try again later.");
            return;
        }

        // ตรวจสอบกรณีไม่มีข้อมูล
        if (!data || data.length === 0) {
            await interaction.reply("No characters available for the leaderboard yet. Please check back later.");
            return;
        }

        // สร้างข้อความ leaderboard
        let statusMessage = '**Leaderboard - Current Votes** \n\n';
        data.forEach((entry, index) => {
            statusMessage += `**${index + 1}. ${entry.character_name}** - ${entry.points_characters} votes\n`;
        });

        // ส่งข้อความ
        await interaction.reply(statusMessage);
    } catch (err) {
        console.error("Unexpected error in handleLeaderboard:", err);
        await interaction.reply("An unexpected error occurred while generating the leaderboard. Please try again later.");
    }
}

async function handleVote(interaction, member, user) {
    if (!botActive) {
        await interaction.reply("The bot is currently inactive. Please ask an admin to activate it.");
        return;
    }

    // Debugging availableCharacters
    console.log("Available Characters:", availableCharacters);

    // Validate availableCharacters structure
    if (!availableCharacters || !Array.isArray(availableCharacters.data)) {
        console.error("Error: availableCharacters.data is not an array. Value:", availableCharacters);
        await interaction.reply("There was an error loading the available characters.");
        return;
    }

    const userRoles = member.roles.cache.map(role => role.name);
    const hasValidRole = userRoles.some(role => /^SS[1-9]$|^SS1[0-2]$/.test(role));

    if (!hasValidRole) {
        await interaction.reply("Sorry, you need a valid role (SS1-SS12) to vote.");
        return;
    }

    if (!userVotes[user.id]) {
        userVotes[user.id] = { points: 0 };
    }

    const character = interaction.options.getString('character');
    const points = interaction.options.getInteger('points');

    if (!availableCharacters.data.some(characterObj => characterObj.character_name === character)) {
        await interaction.reply(`The character "${character}" is not available for voting.`);
        return;
    }

    if (userVotes[user.id].points < points) {
        await interaction.reply("You do not have enough points to vote.");
        return;
    }

    if (!userVotes[user.id][character]) {
        userVotes[user.id][character] = 0;
    }

    userVotes[user.id][character] += points;
    userVotes[user.id].points -= points;

    try {
        const { error: voteError } = await supabase
          .from('user_votes')
          .upsert([
            {
              user_id: user.id,
              points_vote: userVotes[user.id].points,
              character_name: character,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ]);

        if (voteError) {
            throw new Error(voteError.message);
        }

        await saveCharacterPoints(character, points);
        await saveDataToDb();

        await interaction.reply(`You have successfully voted for "${character}". New points: ${points}`);
    } catch (error) {
        console.error("Error handling vote:", error);
        await interaction.reply("An error occurred while saving your vote. Please try again.");
    }
}

async function handleActive(interaction, user) {
    if (user.id !== adminUserId) {
        await interaction.reply("You do not have permission to activate/deactivate the bot.");
        return;
    }

    // เปลี่ยนสถานะของบอท
    botActive = !botActive;

    // บันทึกสถานะลงในฐานข้อมูล (หากต้องการ)
    await saveBotStatusToDb(botActive);  // สมมุติว่าเราใช้ฟังก์ชันนี้สำหรับบันทึกสถานะ

    await interaction.reply(`The bot is now ${botActive ? 'active' : 'inactive'}.`);
}

// ฟังก์ชันที่ใช้สำหรับจัดการคำสั่ง 'mypoints'
async function handleMyPoints(interaction) {
    // ตรวจสอบคะแนนจากฐานข้อมูล หรือในกรณีนี้อาจเป็น userVotes
    const userPoints = userVotes[interaction.user.id] ? userVotes[interaction.user.id].points : 0;

    // ส่งข้อความตอบกลับ
    if (userPoints > 0) {
        await interaction.reply(`You have ${userPoints} vote points available.`);
    } else {
        await interaction.reply("You currently have no vote points.");
    }
}

async function handleSetVotePlus(interaction) {
    if (interaction.user.id !== adminUserId && interaction.user.id !== adminSetPointUserId) {
        await interaction.reply("You do not have permission to set votes.");
        return;
    }

    const target = interaction.options.getString('target');
    const userOrRole = interaction.options.getUser('user_or_role') || interaction.options.getRole('user_or_role');
    const points = interaction.options.getInteger('points');

    if (target === 'user') {
        if (!userVotes[userOrRole.id]) {
            userVotes[userOrRole.id] = { points: 0 };
        }
        userVotes[userOrRole.id].points = Math.min(userVotes[userOrRole.id].points + points, 9999);
        await interaction.reply(`${userOrRole.username}'s vote points have been increased by ${points} points.`);
    } else if (target === 'role') {
        const membersWithRole = interaction.guild.members.cache.filter(member => member.roles.cache.has(userOrRole.id));
        membersWithRole.forEach(async (member) => {
            if (!userVotes[member.id]) {
                userVotes[member.id] = { points: 0 };
            }
            userVotes[member.id].points = Math.min(userVotes[member.id].points + points, 9999);
        });
        await interaction.reply(`Votes for all members with the role ${userOrRole.name} have been increased by ${points} points.`);
    }

    // Save updated points to the database
    await saveDataToDb(); // Save all user vote data to the user_point table in Supabase
}

async function handleSetVoteMinus(interaction) {
    if (interaction.user.id !== adminUserId && interaction.user.id !== adminSetPointUserId) {
        await interaction.reply("You do not have permission to set votes.");
        return;
    }

    const target = interaction.options.getString('target');
    const userOrRole = interaction.options.getUser('user_or_role') || interaction.options.getRole('user_or_role');
    const points = interaction.options.getInteger('points');

    if (target === 'user') {
        if (!userVotes[userOrRole.id]) {
            userVotes[userOrRole.id] = { points: 0 };
        }
        userVotes[userOrRole.id].points = Math.max(userVotes[userOrRole.id].points - points, 0);
        await interaction.reply(`${userOrRole.username}'s vote points have been decreased by ${points} points.`);
    } else if (target === 'role') {
        const membersWithRole = interaction.guild.members.cache.filter(member => member.roles.cache.has(userOrRole.id));
        membersWithRole.forEach(async (member) => {
            if (!userVotes[member.id]) {
                userVotes[member.id] = { points: 0 };
            }
            userVotes[member.id].points = Math.max(userVotes[member.id].points - points, 0);
        });
        await interaction.reply(`Votes for all members with the role ${userOrRole.name} have been decreased by ${points} points.`);
    }

    // Save updated points to the database
    await saveDataToDb(); // Save all user vote data to the user_point table in Supabase
}

// Save all user votes to Supabase
async function saveDataToDb() {
    try {
        const userPointsArray = Object.entries(userVotes).map(([userId, votes]) => ({
            user_id: userId,
            user_point: votes.points, // Store points in the user_point column
            updated_at: new Date().toISOString(), // Set updated_at timestamp
        }));

        // Upsert the user points data to the user_point table in Supabase
        const { error } = await supabase.from('user_point').upsert(userPointsArray, { onConflict: ['user_id'] });

        if (error) {
            throw new Error(error.message);
        }

        console.log("Data saved to Supabase successfully.");
    } catch (error) {
        console.error("Error saving data to Supabase:", error);
    }
}

// ฟังก์ชันสำหรับจัดการคำสั่ง 'setcharacters'
async function handleSetCharacters(interaction, user) {
    if (user.id !== adminUserId && user.id !== adminSetPointUserId) {
        await interaction.reply("You do not have permission to set characters.");
        return;
    }

    const characters = interaction.options.getString('characters');
    const characterList = characters.split(',').map(character => character.trim());

    // อัปเดตข้อมูลตัวละครในฐานข้อมูล
    try {
        // ทำการอัปเดตตัวละครในฐานข้อมูล (เช่น การเปลี่ยนแปลงสถานะของตัวละครหรือเพิ่มตัวละครใหม่)
        const { data, error } = await supabase
            .from('characters')
            .upsert(
                characterList.map(character => ({
                    character_name: character,
                    available: true,  // ตั้งค่าว่าตัวละครนี้พร้อมให้โหวต
                    points_characters: 0,  // คะแนนเริ่มต้นเป็น 0
                }))
            );

        if (error) {
            throw new Error(error.message);
        }

        // อัปเดต availableCharacters หลังจากบันทึก
        availableCharacters = await supabase
            .from('characters')
            .select('*')
            .eq('available', true);

        await interaction.reply(`The characters have been updated: ${characterList.join(', ')}`);
    } catch (error) {
        console.error("Error updating characters:", error);
        await interaction.reply("An error occurred while setting characters. Please try again.");
    }
}

async function handleResetVotes(interaction) {
    try {
        // ลบข้อมูลจากตาราง user_votes
        const { error: userVotesError } = await supabase
            .from('user_votes')
            .delete()
            .neq('user_id', null);  // ลบข้อมูลทั้งหมดในตาราง user_votes

        if (userVotesError) {
            throw new Error(userVotesError.message);
        }

        // ลบข้อมูลจากตาราง characters
        const { error: charactersError } = await supabase
            .from('characters')
            .delete()
            .neq('character_name', null);  // ลบข้อมูลทั้งหมดในตาราง characters

        if (charactersError) {
            throw new Error(charactersError.message);
        }

        await interaction.reply('Votes and character data have been successfully reset. User points remain unchanged.');
    } catch (error) {
        console.error("Error resetting votes:", error);
        await interaction.reply("An error occurred while resetting the data. Please try again later.");
    }
}

// ฟังก์ชันอื่น ๆ สามารถทำตามแนวทางเดียวกันนี้
client.login(token);
