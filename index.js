const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, Events, InteractionType } = require('discord.js');
const axios = require('axios');

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Configuration from environment variables (for Render)
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

// Slash command definition
const commands = [
    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Search for data breaches by email, IP, or client ID')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Email, IP address, or client ID to search')
                .setRequired(false))
];

// Function to register slash commands
async function registerCommands() {
    try {
        console.log('Registering slash commands...');
        
        // Register globally
        const response = await axios.put(
            `https://discord.com/api/v10/applications/${CLIENT_ID}/commands`,
            commands.map(cmd => cmd.toJSON()),
            {
                headers: {
                    'Authorization': `Bot ${TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log(`Successfully registered ${commands.length} command(s)`);
        return response.data;
    } catch (error) {
        console.error('Error registering commands:', error.response?.data || error.message);
        throw error;
    }
}

// Function to query Oathnet API
async function queryOathnet(query) {
    try {
        console.log(`Querying Oathnet for: ${query}`);
        
        const response = await axios.get('https://oathnet.org/api', {
            params: {
                query: query,
                type: 'search'
            },
            headers: {
                'User-Agent': 'Discord-Breakdown-Bot/1.0',
                'Accept': 'application/json'
            },
            timeout: 10000 // 10 second timeout
        });
        
        return response.data;
    } catch (error) {
        console.error('Oathnet API error:', error.message);
        
        if (error.response) {
            console.error('API Response status:', error.response.status);
            console.error('API Response data:', error.response.data);
        }
        
        throw new Error(`Failed to query Oathnet API: ${error.message}`);
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
        .setFooter({ text: 'Powered by Oathnet.org', iconURL: 'https://oathnet.org/favicon.ico' });
    
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
        // Limit to first 10 results to avoid embed field limits
        const displayResults = data.results.slice(0, 10);
        
        displayResults.forEach((result, index) => {
            let value = '';
            
            if (result.source) value += `**Source:** ${result.source}\n`;
            if (result.date) value += `**Date:** ${result.date}\n`;
            if (result.type) value += `**Type:** ${result.type}\n`;
            if (result.details) value += `**Details:** ${result.details.substring(0, 100)}${result.details.length > 100 ? '...' : ''}\n`;
            
            if (value) {
                embed.addFields({
                    name: `Breach #${index + 1}`,
                    value: value || 'No details available',
                    inline: false
                });
            }
        });
        
        if (data.results.length > 10) {
            embed.addFields({
                name: 'Note',
                value: `Showing 10 of ${data.results.length} total results.`,
                inline: false
            });
        }
    } else if (data.breaches && Array.isArray(data.breaches) && data.breaches.length > 0) {
        // Alternative data structure
        data.breaches.slice(0, 10).forEach((breach, index) => {
            let value = '';
            
            if (breach.name) value += `**Name:** ${breach.name}\n`;
            if (breach.domain) value += `**Domain:** ${breach.domain}\n`;
            if (breach.breachDate) value += `**Breach Date:** ${breach.breachDate}\n`;
            if (breach.description) value += `**Description:** ${breach.description.substring(0, 100)}...\n`;
            
            embed.addFields({
                name: `Breach ${index + 1}`,
                value: value || 'No details available',
                inline: false
            });
        });
    } else {
        embed.addFields({
            name: 'No Breach Data',
            value: 'No specific breach records were found for this query.',
            inline: false
        });
    }
    
    // Add links if available
    if (data.links && Array.isArray(data.links) && data.links.length > 0) {
        const linkList = data.links.slice(0, 5).map(link => `• ${link}`).join('\n');
        embed.addFields({
            name: 'Related Links',
            value: linkList + (data.links.length > 5 ? `\n*...and ${data.links.length - 5} more*` : ''),
            inline: false
        });
    }
    
    return embed;
}

// Event: When bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log(`Invite URL: https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=2147485696`);
    
    // Register slash commands
    try {
        await registerCommands();
    } catch (error) {
        console.error('Failed to register commands. The bot will still run but commands may not work.');
    }
    
    // Set bot status
    client.user.setActivity('/lookup | Oathnet Breach Search', { type: 'WATCHING' });
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
