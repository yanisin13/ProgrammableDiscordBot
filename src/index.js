var _ = {};
var global = {
    discord: require('discord.js'),
    fs: require('fs'),
    https: require('https'),

    LOCATION_CONFIG: 'config.json',
    LOCATION_APPROVED_IDS: 'approvedIDs.json',
    LOCATION_BOT_LOG: 'log.txt',
    LOCATION_STATE: 'state.js',
    LOCATION_STATE_DUMP: 'stateDump.js',

    PATTERN_CODE_BLOCK: ['^```javascript\n', '\n```$'],
    FORMAT_CODE_BLOCK: '```javascript\n{0}\n```',

    FORMAT_PROMISE_REJECTION: 'Promise rejected:```\n{0}\n```',
    FORMAT_EXECUTE_ERROR: 'Failed to execute code:\n```{0}```',
    FORMAT_APPROVE_USER: 'Code execution granted to: <@{0}>',
    FORMAT_REVOKE_APPROVAL_USER: 'Code execution revoked from: <@{0}>',
    FORMAT_APPROVE_MESSAGE: 'Message with id \'{0}\' approved for execution',
    FORMAT_REVOKE_APPROVAL_MESSAGE: 'Message with id \'{0}\' approval revoked for execution',
    FORMAT_MESSAGE_NOT_APPROVED: 'Message with id \'{0}\' not approved for execution',
    MESSAGE_BOT_KILLED: 'Bot was killed for doing too many actions. Bot State Dump:',
    MESSAGE_CODE_EXECUTED: 'Code has been executed',
    MESSAGE_BOT_READY: 'Bot Ready',

    PATTERN_USER_ID: '^\<(\@|\#)[\!0-9]+\>$',

    FORMAT_CUSTOM_CODE_STRING: '"{0}"',
    FORMAT_CUSTOM_CODE_STATE: '["{0}"] = ',
    FORMAT_CUSTOM_CODE_PARENT: '["{0}"]',

    BASE_COMMANDS: [
        {
            name: ['execute', 'e'],
            masterUserCommand: false,
            func: (x, id) => global.loadMessage(id)
        },
        {
            name: ['approve-message', 'am'],
            masterUserCommand: true,
            func: (x, id) => global.approveMessage(id)
        },
        {
            name: ['is-approved', 'ia'],
            masterUserCommand: false,
            func: (x, id) => console.log(global.isApproved(id))
        },
        {
            name: ['disapprove-message', 'dm'],
            masterUserCommand: true,
            func: (x, id) => global.disapproveMessage(id)
        },
        {
            name: ['approve-user', 'au'],
            masterUserCommand: true,
            func: (x, id) => global.approveUser(id)
        },
        {
            name: ['disapprove-user', 'du'],
            masterUserCommand: true,
            func: (x, id) => global.disapproveUser(id)
        },
        {
            name: ['clear-approved', 'ca'],
            masterUserCommand: true,
            func: () => global.clearApproved()
        },
        {
            name: ['refresh', 'r'],
            masterUserCommand: false,
            func: () => global.refresh()
        },
        {
            name: ['save', 's'],
            masterUserCommand: true,
            func: () => global.saveState()
        },
        {
            name: ['load', 'l'],
            masterUserCommand: true,
            func: url => global.loadState(url)
        },
        {
            name: ['kill', 'k'],
            masterUserCommand: true,
            func: () => process.exit(1)
        },
        {
            name: ['clear-state', 'cs'],
            masterUserCommand: true,
            func: () => global.clearState()
        },
        {
            name: ['dump-state', 'ds'],
            masterUserCommand: false,
            func: () => global.dumpState().then(global.outputStateDump)
        },
        {
            name: ['get-log', 'gl'],
            masterUserCommand: false,
            func: () => global.getLog()
        }
    ],

    FLAGGED_WORDS: [
        'eval',
        'global',
        'process'
    ],
    MESSAGE_WAIT_TIME: 500,

    CLEAR_STATE_TIME: 3000,
    RESET_MSG_COUNT_TIME: 3000,
    MAX_MESSAGES: 15,

    startClearState: false,
    userRepo: [],
    messageCount: 0,

    message: {
        init: () => global.message.promise = new Promise(r => global.message.resolve = r),
        queue: [],
    },
    load: () => {

        var g = global;
        g.client = new g.discord.Client();

        g.client.on('ready', () => {
            g.message.init();
            g.log(g.MESSAGE_BOT_READY);
            g.loadState().then(() => {
                _.custom.events.filter(event => event.eventName === 'ready').forEach(event => event.func());
                g.checkStateDump();
            });
            startClearState = true;
            setInterval(() => startClearState = false, g.CLEAR_STATE_TIME);
        });

        g.client.on('message', message => {
            if (message.author.id !== g.client.user.id) {
                _.bot.lastMessage = message;
                if (g.isExecutableMessage(message) && g.userCanExecute()) {
                    g.executeCode(message.content);
                }
                if (message.content.substr(0, g.config.botPrefix.length) === g.config.botPrefix && message.author.id !== g.client.user.id) {
                    var segs = message.content.toString().split('`')
                        .map((x, i) => i % 2 == 1 ? encodeURIComponent(x) : x).join('').split(' ').map(x => {
                            x = decodeURIComponent(x);
                            x = g.testPattern(x, g.PATTERN_USER_ID) ? g.getID(x) : x;
                            return x;
                        });
                    var command = [...g.BASE_COMMANDS, ..._.custom.commands].find(command => !!~[].concat(command.name).indexOf(segs[0].split(g.config.botPrefix)[1]));
                    if (command && (!command.masterUserCommand || (command.masterUserCommand && g.isMasterUser()))) {
                        try {
                            command.func(...[g.clean(message), ...segs.slice(1)]);
                        } catch(e) {
                            g.logError(e);
                        }
                    }
                }
                try {
                    _.custom.events.filter(event => event.eventName === 'message').forEach(event => event.func(g.clean(message)));
                } catch (e) {
                    g.logError(e);
                }
            } else {
                g.messageCount++;
                if (g.messageCount >= g.MAX_MESSAGES && !g.killing) {
                    g.killing = true;
                    if (startClearState) {
                        g.dumpState().then(() => g.clearState().then(() => process.exit(1)))
                            .catch(g.logPromiseRejection);
                    } else {
                        process.exit(1);
                    }
                }
                if (g.resetMessageCountInt) {
                    clearInterval(g.resetMessageCountInt);
                }
                g.resetMessageCountInt = setTimeout(() => g.messageCount = 0, g.RESET_MSG_COUNT_TIME);
            }
        });

        g.client.login(g.config.botToken);
    },
    loadMessage: id => {
        var g = global;
        id = !id ? _.bot.lastMessage.id : id;
        g.client.channels.get(_.bot.lastMessage.channel.id).fetchMessage(id).then(message => {
            if (g.isApproved(message.id) || g.isMasterUser()) {
                if(message.attachments.first()) {
                    g.getFile(message.attachments.first().url).then(data => {
                        g.executeCode(data);
                    })
                } else {
                    g.executeCode(message.content);
                }
            } else {
                console.log(g.format(g.FORMAT_MESSAGE_NOT_APPROVED,message.id), true);
            }
        });
    },
    updateMessage: (id, messageId, content) => {
        var g = global;
        g.getMessage(id, messageId).then(message => message.edit(content).catch(global.logPromiseRejection));
    },
    deleteMessage: (id, messageId) => {
        var g = global;
        g.getMessage(id, messageId).then(message => message.delete().catch(global.logPromiseRejection));
    },
    getMessage: (id, messageId) => {
        var g = global;
        switch(g.getChannel(id).type) {
            case 'text':
                return g.client.channels.get(id).fetchMessage(messageId);
                break;
            case 'dm':
                return g.client.fetchUser(id).then(user => user.dmChannel.fetchMessage(messageId));
                break
                
        } 
    },
    queueMessage: (id, message) => {
        var g = global;
        g.message.queue.push({
            content: message,
            channel: g.getChannel(id)
        });
        clearInterval(g.pushInt);
        g.pushInt = setInterval(() => g.writeMessage(), g.MESSAGE_WAIT_TIME);
        return g.message.promise;
    },
    writeMessage: () => {
        var g = global;
        var channels = [];
        var promises = [];
        g.message.queue.forEach(item => {
            if(!~channels.map(x => x.id).indexOf(item.channel.id)) {
                channels.push(item.channel);
            }
        });
        channels.forEach(channel => {
            var messages = g.message.queue.filter(item => item.channel.id === channel.id).map(item => item.content);
            while(messages.length > 0) {
                var count = 1;
                var message = messages.slice(0, count)
                while(message.join('\n').length < 2000 && message.length < count) {
                    count++;
                    message = messages.slice(0, count);
                }
                count = message.join('\n') > 2000 ? count - 1 : count;
                message = messages.slice(0, count).join('\n');
                messages.splice(0, count);
                messageSegs = g.divideMessage(message);
                messageSegs.forEach(seg => {
                    switch (channel.type) {
                        case 'text':
                                promises.push(g.client.channels.get(channel.id).send(seg).then(message => g.clean(message)));
                            break;
                        case 'dm':
                                promises.push(g.client.fetchUser(channel.id).then(user => user.send(seg)).then(message => global.clean(message)));
                            break;
                    }
                });
            }
        });
        g.message.queue = [];
        Promise.all(promises).then(messages => g.message.resolve(messages)).catch(g.logPromiseRejection);
        clearInterval(g.pushInt);
    },
    divideMessage: message => {
        var g = global;
        var segs = [];
        while(message.length > 0) {
            if(g.isCodeBlock(message)) {
                message = g.getCodeBlock(message).split('\n');
                var count = 0;
                var currentSeg = [];
                var resolvedSeg = '';
                while(resolvedSeg.length < 2000 && count <= message.length) {
                    count++;
                    currentSeg = message.slice(0, count);
                    resolvedSeg = g.format(g.FORMAT_CODE_BLOCK, currentSeg.join('\n'));
                }
                count = resolvedSeg.length > 2000 ? count - 1 : count;
                if(count > 0) {
                    currentSeg = message.slice(0, count);
                    resolvedSeg = g.format(g.FORMAT_CODE_BLOCK, currentSeg.join('\n'));
                    message.splice(0, count);
                    segs.push(resolvedSeg);
                } else {
                    var divide = message[0];
                    message.splice(0,1);
                    var dividedLines = [];
                    while(divide.length > 0) {
                        dividedLines.push(divide.substr(0,2000 - g.FORMAT_CODE_BLOCK.length));
                        divide = divide.substr(2000 - g.FORMAT_CODE_BLOCK.length);
                    }
                    message = [...dividedLines, ...message];
                }
                message = message.length > 0 ? g.format(g.FORMAT_CODE_BLOCK, message.join('\n')) : '';
            } else {
                segs.push(message.substr(0, 2000));
                message = message.substr(2000);
            }
        }
        return segs;
    },
    logPromiseRejection: message => {
        var g = global;
        console.log(g.format(g.FORMAT_PROMISE_REJECTION, message), true);
    },
    logError: exception => {
        var g = global;
        console.log(g.format(g.FORMAT_EXECUTE_ERROR, exception), true);
        g.log(exception);
    },
    executeCode: code => {
        var g = global;
        try {
            var codeBlock = g.removeWords(g.getCodeBlock(code), g.FLAGGED_WORDS);
            eval(codeBlock);
            if(g.message.queue.length == 0) {
                console.log(g.MESSAGE_CODE_EXECUTED, true);
            }
        } catch (e) {
            g.logError(e);
        }
    },
    removeWords: (value, words) => {
        words.forEach(word => {
            while (!!~value.indexOf(word)) {
                value = value.replace(word, '');
            }
        });
        return value;
    },
    approveUser: user => {
        var g = global;
        if (g.isMasterUser()) {
            g.approvedIDs.push(user);
            console.log(g.format(g.FORMAT_APPROVE_USER, user), true);
        }
    },
    disapproveUser: user => {
        var g = global;
        if (g.isMasterUser()) {
            if (g.isApproved(user.id)) {
                g.approvedIDs.splice(g.approvedIDs.indexOf(user.id), 1);
                console.log(g.format(g.FORMAT_REVOKE_APPROVAL_USER, user), true);
            }
        }
    },
    approveMessage: messageID => {
        var g = global;
        if (g.isMasterUser()) {
            g.client.channels.get(_.bot.lastMessage.channel.id).fetchMessage(messageID)
                .then(message => {
                    g.client.channels.get(_.bot.lastMessage.channel.id).send(message.content).then(message => {
                        g.approvedIDs.push(message.id);
                        console.log(g.format(g.FORMAT_APPROVE_MESSAGE, message.id), true);
                    }).catch(g.logPromiseRejection);
                });
        }
    },
    clearApproved: () => {
        var g = global;
        g.approvedIDs = [];
    },
    disapproveMessage: messageID => {
        var g = global;
        if (global.isMasterUser()) {
            if (!!~global.approvedIDs.indexOf(messageID)) {
                global.approvedIDs.splice(global.approvedIDs.indexOf(messageID), 1);
                console.log(global.format(g.FORMAT_REVOKE_APPROVAL_MESSAGE, messageID), true);
            }
        }
    },
    isExecutableMessage: message => {
        var g = global;
        return g.isCodeBlock(message.content);
    },
    isMasterUser: () => {
        var g = global;
        return (!_.bot || !_.bot.lastMessage) || _.bot.lastMessage.author.id === g.config.masterUserID;
    },
    userCanExecute: () => {
        var g = global;
        return g.isMasterUser() || g.isApproved(_.bot.lastMessage.author.id);
    },
    isCodeBlock: item => {
        var g = global;
        return g.testPattern(item, g.PATTERN_CODE_BLOCK);
    },
    getCodeBlock: item => {
        var g = global;
        g.PATTERN_CODE_BLOCK.forEach(pattern => item = item.replace(new RegExp(pattern), ''));
        return item
    },
    isApproved: id => {
        var g = global;
        return !!~[...g.approvedIDs, g.config.masterUserID].indexOf(id);
    },
    saveState: () => {
        var g = global;
        var promises = [];
        delete (_.bot);
        var customContent = g.createEvalScript(['_'], _);
        promises.push(new Promise(r => g.fs.writeFile(g.LOCATION_STATE, customContent.join(';\n') + ';', () => r())));
        promises.push(new Promise(r => g.fs.writeFile(g.LOCATION_APPROVED_IDS, JSON.stringify(g.approvedIDs), () => r())));
        g.refresh();
        return Promise.all(promises);
    },
    clearState: () => {
        var g = global;
        g.reset();
        return g.saveState();
    },
    loadState: url => {
        var g = global;
        var promises = [];
        if (g.isMasterUser()) {
            g.reset();
            var resolve = (data, r) => {
                if (data) {
                    try {
                        eval(data.toString());
                    } catch (e) {
                        g.logError(e);
                    }
                }
                g.refresh();
                r();
            }
            if (url) {
                promises.push(new Promise(r => g.getFile(url).then(data => resolve(data, r))));
            } else {
                promises.push(new Promise(r => g.fs.readFile(g.LOCATION_STATE, (err, data) => {
                    resolve(data, r);
                })));
            }
            promises.push(new Promise(r => g.fs.readFile(g.LOCATION_APPROVED_IDS, (err, data) => {
                try {
                    if (data) {
                        g.approvedIDs = JSON.parse(data.toString());
                    }
                } catch (e) {
                    g.approvedIDs = [];
                }
                r();
            })));
        }
        return Promise.all(promises);
    },
    getChannel: id => {
        return {
            id: id,
            type: global.client.channels.get(id) ? 'text' : 'dm'
        }
    },
    checkStateDump: () => {
        var g = global;
        g.fs.readFile(g.LOCATION_STATE_DUMP, (err, data) => {
            if (data && data.toString().trim() != '') {
                console.log(g.MESSAGE_BOT_KILLED, true).then(g.outputStateDump)
                    .catch(g.logPromiseRejection);
            }
        });
    },
    createEvalScript: (base, obj) => {
        var g = global;
        var results = [];
        for (var p in obj) {
            if (obj.hasOwnProperty(p) && typeof(obj[p]) != 'undefined') {
                if (typeof (obj[p]) !== 'object') {
                    results.push(base.join('') + g.format(g.FORMAT_CUSTOM_CODE_STATE, p) +
                        (typeof (obj[p]) === 'string' ? g.stringify(g.format(g.FORMAT_CUSTOM_CODE_STRING, obj[p])) : obj[p].toString()));
                } else {
                    results.push(base.join('') + g.format(g.FORMAT_CUSTOM_CODE_STATE, p) +
                        (obj[p].constructor === Array ? '[]' : '{}'));
                    g.createEvalScript([...base, g.format(g.FORMAT_CUSTOM_CODE_PARENT, p)], obj[p]).forEach(v => results.push(v));
                }
            }
        }
        return results;
    },
    bot: {
        message: {
            create: (id, content) => global.queueMessage(id, content),
            update: (id, messageID, content) => global.updateMessage(id, messageID, content),
            delete: (id, messageID) => global.deleteMessage(id, messageID)
        },
        command: {
            add: (name, func) => global.loadFunc(name, func, _.custom.commands),
            remove: name => global.removeFunc(name, _.custom.commands)
        },
        event: {
            add: (name, func, eventName) => global.loadFunc(name, func, _.custom.events, eventName),
            remove: name => global.removeFunc(name, _.custom.events)
        },
        setNickname: (guild, name, user) => {
            user = typeof(user) === 'undefined' ? global.client.user.id : user;
            return global.client.guilds.get(guild).fetchMember(user)
                .then(member => member.setNickname(name)).catch(global.logPromiseRejection)
        },
        log: x => global.log(x)
    },
    removeFunc: (name, array) => {
        array.forEach((v, i) => {
            if (v.name == name) {
                array.splice(i, 1);
            }
        });
    },
    loadFunc: (name, func, array, eventName) => {
        var g = global;
        g.removeFunc(name, array);
        array.push({
            name: name,
            func: func,
            masterUserCommand: false,
            eventName: eventName
        });
    },
    refresh: () => {
        var g = global;
        console.log = (x, r) => {
            var g = global;
            var c = _.bot.lastMessage.channel;
            var message = !r ? g.format(g.FORMAT_CODE_BLOCK, x + '') : x + '';
            g.log(message)
            return g.queueMessage(c.type === 'text' ? c.id : c.recipient.id, message);
        }
        _.bot = g.bot;
    },
    reset: () => {
        var g = global;
        _ = {
            custom: {
                commands: [],
                events: []
            }
        };
        g.refresh();
    },
    testPattern: (content, patterns) => {
        patterns = [].concat(patterns);
        var valid = true;
        patterns.forEach(pattern => {
            var regExp = new RegExp(pattern);
            if (!regExp.test(content)) {
                valid = false;
            }
        });
        return valid;
    },
    format: (format, ...args) => {
        args.forEach((arg, i) => {
            var search = '{' + i + '}';
            while (!!~format.indexOf(search)) {
                format = format.replace(search, arg + '');
            }
        });
        return format;
    },
    clean: (obj, arr, collected) => {
        collected = collected || [];
        var result = arr ? [] : {};
        var g = global;
        for (var p in obj) {
            if (!obj.hasOwnProperty || obj.hasOwnProperty(p) && isNaN(parseInt(p)) && obj[p] != null) {
                if (typeof (obj[p]) === 'object') {
                    if (!~collected.indexOf(obj[p])) {
                        collected.push(obj[p]);
                        var property = global.clean(obj[p], obj[p].constructor === Array, collected);
                        if(JSON.stringify(property) != '{}' && JSON.stringify(property) != '[]' && property != null) {
                            result[p] = property;
                        }
                    }
                } else if (typeof (obj[p]) !== 'function') {
                    result[p] = obj[p];
                }
            }
        }
        return result;
    },
    dumpState: () => {
        var g = global;
        delete (_.bot);
        var state = g.createEvalScript(['_'], _).join(';\n') + ';';
        g.refresh();
        return new Promise(r => g.fs.writeFile(g.LOCATION_STATE_DUMP, state, () => r()));
    },
    outputStateDump: () => {
        var g = global;
        _.bot.message.create(_.bot.lastMessage.channel.id, {
            file: g.LOCATION_STATE_DUMP
        }).then(() => g.fs.writeFile(g.LOCATION_STATE_DUMP, '', () => {}))
            .catch(g.logPromiseRejection);
    },
    getLog: () => {
        var g = global;
        return g.fs.readFile(g.LOCATION_BOT_LOG, (err, data) => {
            console.log(data, true);
        });
    },
    getID: rawID => {
        var patt = new RegExp('[0-9]+');
        return patt.exec(rawID)[0];
    },
    getFile: url => {
        var g = global;
        return new Promise(r => {
            g.https.get(url, response => {
                var data = '';
                response.on('data', block => data += block);
                response.on('end', () => r(data));
            });
        });
    },
    checkExists: x => {
        var i = _;
        x = x.split('.');
        x.splice(0,1);
        while(x.length>0) {
            if(i[x[0]]) {
                i = i[x[0]];
                x.splice(0,1);
            } else {
                return false;
            }
        }
        return true;
    },
    stringify: x => {
        x = JSON.stringify(x);
        while(!!~x.indexOf('\"\\\"')) {
            x = x.replace('\"\\\"','\"');
        }
        while(!!~x.indexOf('\\\"\"')) {
            x = x.replace('\\\"\"','\"');
        }
        return x;
    }
}

global.log = console.log;
global.refresh();

require('fs').readFile(global.LOCATION_CONFIG, (err, data) => {
    global.config = JSON.parse(data);
    global.load();
});

require = undefined;