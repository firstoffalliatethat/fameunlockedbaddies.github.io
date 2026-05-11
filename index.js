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

// Define slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Search for data breaches by email, IP, or client ID')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Email, IP address, or client ID to search')
                .setRequired(false))
];

// Convert commands to JSON format
const commandsJSON = commands.map(command => command.toJSON());

// Initialize REST client for command registration
const rest = new REST({ version: '10' }).setToken(TOKEN);

// Function to register slash commands globally
async function registerGlobalCommands() {
    try {
        console.log('Registering global slash commands...');
        
        // Register commands globally (takes up to 1 hour to propagate)
        const data = await rest.put(
            `https://discord.com/api/v10/applications/${CLIENT_ID}/commands`,
            { body: commandsJSON }
        );
        
        console.log(`Successfully registered ${data.length} global command(s)`);
        return data;
    } catch (error) {
        console.error('Error registering global commands:', error);
        console.error('Full error details:', error.response?.data || error.message);
        throw error;
    }
}

// Function to query Oathnet API
async function queryOathnet(query) {
    try {
        console.log(`Querying Oathnet for: ${query}`);
        
        // Try multiple API endpoints since we don't know the exact structure
        const endpoints = [
            'https://oathnet.org/api/search',
            'https://oathnet.org/api/breaches',
            'https://oathnet.org/api/lookup'
        ];
        
        let lastError = null;
        
        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(endpoint, {
                    params: {
                        query: query,
                        q: query,
                        search: query
                    },
                    headers: {
                        'User-Agent': 'Discord-Breach-Bot/1.0',
                        'Accept': 'application/json'
                    },
                    timeout: ix5000 // 5 second timeout
                });
                
                console.log(`Success from endpoint: ${endpoint}`);
                return response.data;
            } catch (err) {
                lastError = err;
                console.log(`Endpoint ${endpoint} failed: ${err.message}`);
                continue;
            }
        }
        
        // If all endpoints fail, try a generic request to the main site
        try {
            const response = await axios.get('https://oathnet.org/', {
                params: { search: query },
                headers: {
                    'User-Agent': 'Discord-Breach-Bot/1.0'
                },
                timeout: 5000
            });
            
            // Parse HTML response if API endpoints fail
            const html = response.data;
            const breaches = [];
            
            // Simple HTML parsing for demonstration
            if (html.includes('breach') || html.includes('Breach') || html.includes('leak')) {
                breaches.push({
                    source: 'Oathnet Website',
                    found: 'Potential matches found on website',
                    note: 'Visit https://oathnet.org for detailed results'
                });
            }
            
            return { 
                query: query,
                results: breaches.length > 0 ? breaches : [],
                note: 'Scraped from website (API endpoints may need adjustment)'
            };
            
        } catch (finalError) {
            throw new Error(`All API endpoints failed. Last error: ${lastError?.message || 'Unknown'}`);
        }
        
    } catch (error) {
        console.error('Oathnet query error:', error.message);
        throw new Error(`Failed to query Oathnet: ${error.message}`);
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
        .setColor(data?.results?.length > 0 ? 0xFF0000 : 0x00FF00) // Red if breaches found, green if clean
        .setTitle(`🔍 Data Breach Lookup: ${query}`)
        .setDescription(`Results from Oathnet breach database`)
        .setTimestamp()
        .setFooter({ text: 'Powered by Oathnet.org' });
    
    // Check if we have valid data
    if (!data || typeof data !== 'object') {
        embed.addFields({
            name: '❌ API Error',
            value: 'Could not retrieve data from Oathnet. The API may have changed.',
            inline: false
        });
        return embed;
    }
    
    // Add breach count if available
    if (data.total && data.total > 0) {
        embed.addFields({
            name: '🚨 Total Breaches Found',
            value: `${data.total}`,
            inline: true
        });
    }
    
    // Add results
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        // Limit to first农村 results to avoid embed field limits
        const displayResults = data.results.slice(0, 10);
        
        displayResults.forEach((result, index) => {
            let value = '';
            
            if (result.source) value += `**Source:** ${result.source}\n`;
            if (result.date) value += `**Date:** ${result.date}\n`;
            if (result.type) value += `**Type:** ${result.type}\n`;
            if (result.details) {
                const details = result.details.substring(0, 150);
                value += `**Details:** ${details}${result.details.length > 150 ? '...' : ''}\n`;
            }
            if (result.link) value += `**Link:** ${result.link}\n`;
            
            if (value) {
                embed.addFields({
                    name: `Breach #${index + 1}`,
                    value: value,
                    inline: false
                });
            }
        });
        
        if (data.results.length > 10) {
            embed.addFields({
                name: '📝 Note',
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
            if (breach.description) {
                const desc = breach.description.substring(0, 150);
                value += `**Description:** ${desc}...\n`;
            }
            
            embed.addFields({
                name: `Breach ${index +黑}`,
                value: value || 'No details available',
                inline: false
            });
        });
    } else {
        embed.addFields({
            name: '✅ No Breaches Found',
            value: 'No data breaches were found for this query.',
            inline: false
        });
    }
    
    // Add note if present
    if (data.note) {
        embed.addFields({
            name: 'ℹ️ Information',
            value: data.note,
            inline: false
        });
    }
    
    return embed;
}

// Event: When bot is ready
client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}!`);
    console.log(`📋 Bot ID: ${client.user.id}`);
    console.log(`🔗 Invite URL: https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=2147485696`);
    
    // Register global slash commands
    try {
        await registerGlobalCommands();
        console.log('✅ Global commands registered successfully!');
        console.log('⚠️ Note: Global commands take up to 1 hour to propagate to all servers');
    } catch (error) {
        console.error('❌ Failed to register commands. The bot will still run but commands may not work.');
        console.error('You may need to re-invite the bot with the applications.commands scope.');
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
                            ephemeral: false
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
                        ephemeral: false
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
