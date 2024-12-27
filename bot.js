const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
require('dotenv').config();

// ดึงค่าจาก secret
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const adminUserId = process.env.ADMIN_USER_ID;
const adminSetPointUserId = process.env.ADMIN_SETPOINT;
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
        name: 'uservoteplus',
        description: 'Add points to a user',
        options: [
            {
                name: 'user',
                type: 6, // เลือก user
                description: 'The user to adjust votes for',
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
        name: 'uservoteminus',
        description: 'Subtract points from a user',
        options: [
            {
                name: 'user',
                type: 6, // เลือก user
                description: 'The user to adjust votes for',
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
        name: 'rolevoteplus',
        description: 'Add points to a role',
        options: [
            {
                name: 'role',
                type: 8, // เลือก role
                description: 'The role to adjust votes for',
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
        name: 'rolevoteminus',
        description: 'Subtract points from a role',
        options: [
            {
                name: 'role',
                type: 8, // เลือก role
                description: 'The role to adjust votes for',
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

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, user } = interaction;

    try {
        // ตรวจสอบ interaction ก่อนที่มันจะหมดอายุ
        if (!interaction.isRepliable()) {
            await interaction.editReply({ content: "Interaction has expired, please try again.", ephemeral: true });
            return;
        }

        // Deferred reply เพื่อหลีกเลี่ยงการหมดอายุ
        await interaction.deferReply({ ephemeral: true });

        // แสดงข้อความบอกว่าบอทกำลังคิดอยู่
        await interaction.editReply('Connecting to DataBase... เซิฟหนูแรมน้อยโปรดเห็นใจหน่อยนะคะพี่ชาย<3...');

        // การประมวลผลคำสั่ง
        switch(commandName) {
            case 'hello':
                await interaction.editReply('Hello, I am your bot!');
                break;
            case 'vote':
                await handleVote(interaction, member, user);
                break;
            case 'active':
                await handleActive(interaction, user);
                break;
            case 'uservoteplus':
                await handleUserVotePlus(interaction);
                break;
            case 'uservoteminus':
                await handleUserVoteMinus(interaction);
                break;
            case 'rolevoteplus':
                await handleRoleVotePlus(interaction);
                break;
            case 'rolevoteminus':
                await handleRoleVoteMinus(interaction);
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
                await interaction.editReply("Unknown command");
        }
    } catch (error) {
        console.error("Error handling interaction:", error);

        // หาก interaction หมดอายุ ให้แจ้งผู้ใช้
        if (error.code === 10062) {
            await interaction.editReply("The interaction has expired or is invalid. Please try again.");
        } else {
            await interaction.editReply("An error occurred while processing your command. Please try again later.");
        }
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
            await interaction.editReply("An error occurred while fetching the leaderboard. Please try again later.");
            return;
        }

        // ตรวจสอบกรณีไม่มีข้อมูล
        if (!data || data.length === 0) {
            await interaction.editReply("No characters available for the leaderboard yet. Please check back later.");
            return;
        }

        // สร้างข้อความ leaderboard
        let statusMessage = '**Leaderboard - Current Votes** \n\n';
        data.forEach((entry, index) => {
            statusMessage += `**${index + 1}. ${entry.character_name}** - ${entry.points_characters} votes\n`;
        });

        // ส่งข้อความ
        await interaction.editReply(statusMessage);
    } catch (err) {
        console.error("Unexpected error in handleLeaderboard:", err);
        await interaction.editReply("An unexpected error occurred while generating the leaderboard. Please try again later.");
    }
}

async function handleVote(interaction, member, user) {
    if (!botActive) {
        await interaction.editReply("The bot is currently inactive. Please ask an admin to activate it.");
        return;
    }

    // Debugging availableCharacters
    console.log("Available Characters:", availableCharacters);

    // Validate availableCharacters structure
    if (!availableCharacters || !Array.isArray(availableCharacters.data)) {
        console.error("Error: availableCharacters.data is not an array. Value:", availableCharacters);
        await interaction.editReply("There was an error loading the available characters.");
        return;
    }

    const userRoles = member.roles.cache.map(role => role.name);
    const hasValidRole = userRoles.some(role => /^SS[1-9]$|^SS1[0-2]$/.test(role));

    if (!hasValidRole) {
        await interaction.editReply("Sorry, you need a valid role (SS1-SS12) to vote.");
        return;
    }

    if (!userVotes[user.id]) {
        userVotes[user.id] = { points: 0 };
    }

    const character = interaction.options.getString('character');
    const points = interaction.options.getInteger('points');

    if (!availableCharacters.data.some(characterObj => characterObj.character_name === character)) {
        await interaction.editReply(`The character "${character}" is not available for voting.`);
        return;
    }

    if (userVotes[user.id].points < points) {
        await interaction.editReply("You do not have enough points to vote.");
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

        await interaction.editReply(`You have successfully voted for "${character}". New points: ${points}`);
    } catch (error) {
        console.error("Error handling vote:", error);
        await interaction.editReply("An error occurred while saving your vote. Please try again.");
    }
}

async function handleActive(interaction, user) {
    if (user.id !== adminUserId) {
        await interaction.editReply("You do not have permission to activate/deactivate the bot.");
        return;
    }

    // เปลี่ยนสถานะของบอท
    botActive = !botActive;

    // บันทึกสถานะลงในฐานข้อมูล (หากต้องการ)
    await saveBotStatusToDb(botActive);  // สมมุติว่าเราใช้ฟังก์ชันนี้สำหรับบันทึกสถานะ

    await interaction.editReply(`The bot is now ${botActive ? 'active' : 'inactive'}.`);
}

// ฟังก์ชันที่ใช้สำหรับจัดการคำสั่ง 'mypoints'
async function handleMyPoints(interaction) {
    // ตรวจสอบคะแนนจากฐานข้อมูล หรือในกรณีนี้อาจเป็น userVotes
    const userPoints = userVotes[interaction.user.id] ? userVotes[interaction.user.id].points : 0;

    // ส่งข้อความตอบกลับ
    if (userPoints > 0) {
        await interaction.editReply(`You have ${userPoints} vote points available.`);
    } else {
        await interaction.editReply("You currently have no vote points.");
    }
}

async function handleUserVotePlus(interaction) {
    const user = interaction.options.getUser('user');
    const points = interaction.options.getInteger('points');

    // ตรวจสอบว่าเป็นแอดมินหรือผู้ช่วยหรือไม่ (เช็กจากผู้สั่งการ)
    if (interaction.user.id !== adminUserId && interaction.user.id !== adminSetPointUserId) {
        await interaction.editReply('You do not have permission to modify votes.');
        return;
    }

    if (!userVotes[user.id]) {
        userVotes[user.id] = { points: 0 };
    }
    userVotes[user.id].points = Math.min(userVotes[user.id].points + points, 9999);
    await interaction.editReply(`${user.username}'s vote points have been increased by ${points} points.`);

    // Save updated points to the database
    await saveDataToDb();
}

async function handleUserVoteMinus(interaction) {
    const user = interaction.options.getUser('user');
    const points = interaction.options.getInteger('points');

    // ตรวจสอบว่าเป็นแอดมินหรือผู้ช่วยหรือไม่ (เช็กจากผู้สั่งการ)
    if (interaction.user.id !== adminUserId && interaction.user.id !== adminSetPointUserId) {
        await interaction.editReply('You do not have permission to modify votes.');
        return;
    }

    if (!userVotes[user.id]) {
        userVotes[user.id] = { points: 0 };
    }
    userVotes[user.id].points = Math.max(userVotes[user.id].points - points, 0);
    await interaction.editReply(`${user.username}'s vote points have been decreased by ${points} points.`);

    // Save updated points to the database
    await saveDataToDb();
}

async function handleRoleVotePlus(interaction) {
    const role = interaction.options.getRole('role');
    const points = interaction.options.getInteger('points');

    // ดึงข้อมูลสมาชิกทั้งหมดใหม่เพื่อให้แน่ใจว่าอัปเดตล่าสุด
    const membersWithRole = await interaction.guild.members.fetch();
    const filteredMembers = membersWithRole.filter(member => member.roles.cache.has(role.id));

    const totalMembers = filteredMembers.size;
    let processedMembers = 0;

    // แจ้งจำนวนสมาชิกในยศก่อน
    await interaction.editReply(`There are ${totalMembers} members with the role ${role.name}. Starting to update votes...`);

    for (const member of filteredMembers.values()) {
        if (!userVotes[member.id]) {
            userVotes[member.id] = { points: 0 };
        }

        // อัปเดตคะแนนโหวต
        userVotes[member.id].points = Math.min(userVotes[member.id].points + points, 9999);

        // เพิ่มคนที่ทำเสร็จ
        processedMembers++;

        // แจ้งความคืบหน้า
        await interaction.editReply(`Updated ${processedMembers}/${totalMembers} members. ${totalMembers - processedMembers} remaining...`);

        // บันทึกข้อมูลลง Supabase
        await saveDataToDb();  // บันทึกลงฐานข้อมูลหลังจากอัปเดตแต่ละคน

        // ดีเลย์ 0.1 วินาที
        await new Promise(resolve => setTimeout(resolve, 100));  // ดีเลย์ 0.1 วินาที
    }

    // แจ้งข้อความสุดท้ายเมื่อทำครบทั้งหมด
    await interaction.editReply(`Votes for all ${totalMembers} members with the role ${role.name} have been increased by ${points} points.`);

    // บันทึกข้อมูลลง Supabase หลังจากเสร็จสิ้น
    await saveDataToDb();
}

async function handleRoleVoteMinus(interaction) {
    const role = interaction.options.getRole('role');
    const points = interaction.options.getInteger('points');

    // ดึงข้อมูลสมาชิกทั้งหมดใหม่เพื่อให้แน่ใจว่าอัปเดตล่าสุด
    const membersWithRole = await interaction.guild.members.fetch();
    const filteredMembers = membersWithRole.filter(member => member.roles.cache.has(role.id));

    const totalMembers = filteredMembers.size;
    let processedMembers = 0;

    // แจ้งจำนวนสมาชิกในยศก่อน
    await interaction.editReply(`There are ${totalMembers} members with the role ${role.name}. Starting to update votes...`);

    for (const member of filteredMembers.values()) {
        if (!userVotes[member.id]) {
            userVotes[member.id] = { points: 0 };
        }

        // อัปเดตคะแนนโหวต
        userVotes[member.id].points = Math.max(userVotes[member.id].points - points, 0);

        // เพิ่มคนที่ทำเสร็จ
        processedMembers++;

        // แจ้งความคืบหน้า
        await interaction.editReply(`Updated ${processedMembers}/${totalMembers} members. ${totalMembers - processedMembers} remaining...`);

        // บันทึกข้อมูลลง Supabase
        await saveDataToDb();  // บันทึกลงฐานข้อมูลหลังจากอัปเดตแต่ละคน

        // ดีเลย์ 2 วินาที
        await new Promise(resolve => setTimeout(resolve, 100));  // ดีเลย์ 0.1 วินาที
    }

    // แจ้งข้อความสุดท้ายเมื่อทำครบทั้งหมด
    await interaction.editReply(`Votes for all ${totalMembers} members with the role ${role.name} have been decreased by ${points} points.`);

    // บันทึกข้อมูลลง Supabase หลังจากเสร็จสิ้น
    await saveDataToDb();
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
        await interaction.editReply("You do not have permission to set characters.");
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

        await interaction.editReply(`The characters have been updated: ${characterList.join(', ')}`);
    } catch (error) {
        console.error("Error updating characters:", error);
        await interaction.editReply("An error occurred while setting characters. Please try again.");
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

        await interaction.editReply('Votes and character data have been successfully reset. User points remain unchanged.');
    } catch (error) {
        console.error("Error resetting votes:", error);
        await interaction.editReply("An error occurred while resetting the data. Please try again later.");
    }
}

// ฟังก์ชันอื่น ๆ สามารถทำตามแนวทางเดียวกันนี้
client.login(token);
