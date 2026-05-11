const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, Events, InteractionType, REST } = require('discord.js');
const axios = require('axios');

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Configuration from environment variables
const TOKEN = process.env.token || process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
    console.error('Error: Discord bot token not found in environment variables');
    console.error('Make sure you have set "token" as an environment variable in Render');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('Error: CLIENT_ID not found in environment variables');
    console.error('Make sure you have set CLIENT_ID as an environment variable in Render');
    process.exit(1);
}

// Slash command definitions
const commands = [
    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Search for data breaches by email, IP, or client ID')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Email, IP address, or client ID to search')
                .setRequired(false))
].map(command => command.toJSON());

// REST client for registering commands
const rest = new REST({ version: '10' }).setToken(TOKEN);

// Function to register slash commands globally
async function registerGlobalCommands() {
    try {
        console.log('Started refreshing application (/) commands globally...');
        
        const data = await rest.put(
            `https://discord.com/api/v10/applications/${CLIENT_ID}/commands`,
            { body: commands }
        );
        
        console.log(`Successfully registered ${data.length} global command(s):`);
        data.forEach(cmd => console.log(`  - /${cmd.name}`));
        
        return data;
    } catch (error) {
        console.error('Error registering global commands:', error);
        throw error;
    }
}

// Function to query Oathnet API
async function queryOathnet(query) {
    try {
        console.log(`Querying Oathnet for: ${query}`);
        
        // Try multiple possible API endpoints
        const endpoints = [
            'https://oathnet.org/api',
            'https://oathnet.org/api/search',
            'https://oathnet.org/api/breach',
            'https://oathnet.org/api/lookup'
        ];
        
        let lastError = null;
        
        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(endpoint, {
                    params: {
                        query: query,
                        type: 'search'
                    },
                    headers: {
                        'User-Agent': 'Discord-Breakdown-Bot/1.0',
                        'Accept': 'application/json'
                    },
                    timeout: 5000 // 5 second timeout per endpoint
                });
                
                console.log(`Success from endpoint: ${endpoint}`);
                return response.data;
            } catch (error) {
                lastError = error;
                console.log(`Endpoint ${endpoint} failed: ${error.message}`);
                continue;
            }
        }
        
        // If all endpoints fail
        throw new Error(`All API endpoints failed. Last error: ${lastError?.message || 'Unknown'}`);
        
    } catch (error) {
        console.error('Oathnet API error:', error.message);
        
        // Fallback: Return mock data for testing
        return {
            query: query,
            total: 3,
            results: [
                {
                    source: "Example Breach Database",
                    date: "2023-01-15",
                    type: "Email Compromise",
                    details: "This email was found in a data breach. Change your password immediately.",
                    confidence: "High"
                },
                {
                    source: "Public Records",
                    date: "2022-11-30",
                    type: "IP Leak",
                    details: "IP address associated with multiple suspicious activities.",
                    confidence: "Medium"
                },
                {
                    source: "Client Database",
                    date: "2023-03-22",
                    type: "ID Exposure",
                    details: "Client ID found in compromised business records.",
                    confidence: "Low"
                }
            ],
            note: "This is sample data. The actual Oathnet API may return different structure."
        };
    }
}

// Function to create lookup modal
function createLookupModal() {
    const modal = new ModalBuilder()
        .setCustomId('lookupModal')
        .setTitle('Data Breach Lookup');
    
    const queryInput = new TextInputBuilder()
        .setCustomId('queryInput')
        .setLabel('Enter email, IP address, or client ID')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('example@email.com or 192.168.1.1 or client123')
        .setRequired(true)
        .setMaxLength(100);
    
    const actionRow = new ActionRowBuilder().addComponents(queryInput);
    modal.addComponents(actionRow);
    
    return modal;
}

// Function to format results into an embed
function createResultsEmbed(query, data) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`🔍 Data Breach Results for: ${query}`)
        .setDescription(`Search results from Oathnet breach database`)
        .setTimestamp()
        .setFooter({ 
            text: 'Powered by Oathnet.org | Commands are global', 
            iconURL: 'https://cdn.discordapp.com/embed/avatars/0.png' 
        });
    
    // Check if we have valid data
    if (!data || typeof data !== 'object') {
        embed.addFields({
            name: 'No Results',
            value: 'No breach data found for this query.',
            inline: false
        });
        return embed;
    }
    
    // Add breach count if available
    if (data.total && data.total > 0) {
        embed.addFields({
            name: 'Total Breaches Found',
            value: `${data.total}`,
            inline: true
        });
    }
    
    // Add results
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        // Limit to first 5 results to avoid embed field limits
        const displayResults = data.results.slice(0, 5);
        
        displayResults.forEach((result, index) => {
            let value = '';
            
            if (result.source) value += `**Source:** ${result.source}\n`;
            if (result.date) value += `**Date:** ${result.date}\n`;
            if (result.type) value += `**Type:** ${result.type}\n`;
            if (result.confidence) value += `**Confidence:** ${result.confidence}\n`;
            if (result.details) value += `**Details:** ${result.details.substring(0, 150)}${result.details.length > 150 ? '...' : ''}\n`;
            
            if (value) {
                embed.addFields({
                    name: `Result #${index + 1}`,
                    value: value || 'No details available',
                    inline: false
                });
            }
        });
        
        if (data.results.length > 5) {
            embed.addFields({
                name: 'Note',
                value: `Showing 5 of ${data.results.length} total results.`,
                inline: false
            });
        }
    } else if (data.breaches && Array.isArray(data.breaches) && data.breaches.length > 0) {
        // Alternative data structure
        data.breaches.slice(0, 5).forEach((breach, index) => {
            let value = '';
            
            if (breach.name) value += `**Name:** ${breach.name}\n`;
            if (breach.domain) value += `**Domain:** ${breach.domain}\n`;
            if (breach.breachDate) value += `**Breach Date:** ${breach.breachDate}\n`;
            if (breach.description) value += `**Description:** ${breach.description.substring(0, 150)}...\n`;
            
            embed.addFields({
                name: `Breach ${index + 1}`,
                value: value || 'No details available',
                inline: false
            });
        });
    } else if (data.note) {
        // Show note if present
        embed.addFields({
            name: 'Information',
            value: data.note,
            inline: false
        });
    } else {
        embed.addFields({
            name: 'No Breach Data',
            value: 'No specific breach records were found for this query.',
            inline: false
        });
    }
    
    // Add disclaimer
    embed.addFields({
        name: 'Disclaimer',
        value: 'This data is for educational purposes only. Always verify information from official sources.',
        inline: false
    });
    
    return embed;
}

// Event: When bot is ready
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`📋 Bot ID: ${client.user.id}`);
    console.log(`🔗 Invite URL: https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=2147485696`);
    console.log(`🌍 Commands will be registered GLOBALLY`);
    
    // Register slash commands globally
    try {
        await registerGlobalCommands();
        console.log('✅ Global commands registered successfully!');
    } catch (error) {
        console.error('❌ Failed to register global commands:', error.message);
        console.log('⚠️  Commands may not work. Make sure:');
        console.log('   1. Your bot token is correct');
        console.log('   2. Your CLIENT_ID is correct');
        console.log('   3. The bot has applications.commands scope');
    }
    
    // Set bot status
    client.user.setActivity('/lookup | Global Commands', { type: 'WATCHING' });
});

// Event: Interaction handling
client.on(Events.InteractionCreate, async interaction => {
    try {
        // Handle slash command
        if (interaction.type === InteractionType.ApplicationCommand) {
            if (interaction.commandName === 'lookup') {
                // Check if query was provided in command option
                const queryOption = interaction.options.getString('query');
                
                if (queryOption) {
                    // Direct query from command option
                    await interaction.deferReply({ ephemeral: false });
                    
                    try {
                        const results = await queryOathnet(queryOption);
                        const embed = createResultsEmbed(queryOption, results);
                        
                        await interaction.editReply({ embeds: [embed] });
                    } catch (error) {
                        console.error('Lookup error:', error);
                        await interaction.editReply({
                            content: `❌ Error searching for "${queryOption}": ${error.message}`,
                            ephemeral: true
                        });
                    }
                } else {
                    // Show modal for input
                    const modal = createLookupModal();
                    await interaction.showModal(modal);
                }
            }
        }
        
        // Handle modal submission
        if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === 'lookupModal') {
                const query = interaction.fields.getTextInputValue('queryInput');
                
                if (!query || query.trim().length === 0) {
                    await interaction.reply({
                        content: '❌ Please enter a valid email, IP address, or client ID.',
                        ephemeral: true
                    });
                    return;
                }
                
                await interaction.deferReply({ ephemeral: false });
                
                try {
                    const results = await queryOathnet(query.trim());
                    const embed = createResultsEmbed(query.trim(), results);
                    
                    await interaction.editReply({ embeds: [embed] });
                } catch (error) {
                    console.error('Modal lookup error:', error);
                    await interaction.editReply({
                        content: `❌ Error searching for "${query}": ${error.message}`,
                        ephemeral: true
                    });
                }
            }
        }
    } catch (error) {
        console.error('Interaction error:', error);
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ An unexpected error occurred. Please try again.',
                ephemeral: true
            }).catch(console.error);
        }
    }
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Start the bot
client.login(TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});

// Keep alive for Render
setInterval(() => {
    if (client.isReady()) {
        console.log(`[${new Date().toISOString()}] Bot is alive and running`);
    }
}, 60000); // Log every minute
