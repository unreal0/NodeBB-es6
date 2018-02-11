var async = require('async');
var os = require('os');
var nconf = require('nconf');
var winston = require('winston');

var topics = require('../../topics');
var pubsub = require('../../pubsub');

var stats = {};
var totals = {};

var SocketRooms = module.exports;

SocketRooms.stats = stats;
SocketRooms.totals = totals;

pubsub.on('sync:stats:start', () => {
	SocketRooms.getLocalStats((err, stats) => {
		if (err) {
			return winston.error(err);
		}
		pubsub.publish('sync:stats:end', { stats: stats, id: os.hostname() + ':' + nconf.get('port') });
	});
});

pubsub.on('sync:stats:end', (data) => {
	stats[data.id] = data.stats;
});

pubsub.on('sync:stats:guests', () => {
	var io = require('../index').server;

	var roomClients = io.sockets.adapter.rooms;
	var guestCount = roomClients.online_guests ? roomClients.online_guests.length : 0;
	pubsub.publish('sync:stats:guests:end', guestCount);
});

SocketRooms.getTotalGuestCount = (callback) => {
	var count = 0;

	pubsub.on('sync:stats:guests:end', (guestCount) => {
		count += guestCount;
	});

	pubsub.publish('sync:stats:guests');

	setTimeout(() => {
		pubsub.removeAllListeners('sync:stats:guests:end');
		callback(null, count);
	}, 100);
};


SocketRooms.getAll = (socket, data, callback) => {
	pubsub.publish('sync:stats:start');

	totals.onlineGuestCount = 0;
	totals.onlineRegisteredCount = 0;
	totals.socketCount = 0;
	totals.topics = {};
	totals.users = {
		categories: 0,
		recent: 0,
		unread: 0,
		topics: 0,
		category: 0,
	};

	for (var instance in stats) {
		if (stats.hasOwnProperty(instance)) {
			totals.onlineGuestCount += stats[instance].onlineGuestCount;
			totals.onlineRegisteredCount += stats[instance].onlineRegisteredCount;
			totals.socketCount += stats[instance].socketCount;
			totals.users.categories += stats[instance].users.categories;
			totals.users.recent += stats[instance].users.recent;
			totals.users.unread += stats[instance].users.unread;
			totals.users.topics += stats[instance].users.topics;
			totals.users.category += stats[instance].users.category;

			stats[instance].topics.forEach((topic) => {
				totals.topics[topic.tid] = totals.topics[topic.tid] || { count: 0, tid: topic.tid };
				totals.topics[topic.tid].count += topic.count;
			});
		}
	}

	var topTenTopics = [];
	Object.keys(totals.topics).forEach((tid) => {
		topTenTopics.push({ tid: tid, count: totals.topics[tid].count || 0 });
	});

	topTenTopics = topTenTopics.sort((a, b) => b.count - a.count).slice(0, 10);

	var topTenTids = topTenTopics.map(topic => topic.tid);

	async.waterfall([
		(next) => {
			topics.getTopicsFields(topTenTids, ['title'], next);
		},
		(titles, next) => {
			totals.topTenTopics = topTenTopics.map((topic, index) => {
				topic.title = titles[index].title;
				return topic;
			});

			next(null, totals);
		},
	], callback);
};

SocketRooms.getOnlineUserCount = (io) => {
	var count = 0;

	if (io) {
		for (var key in io.sockets.adapter.rooms) {
			if (io.sockets.adapter.rooms.hasOwnProperty(key) && key.startsWith('uid_')) {
				count += 1;
			}
		}
	}

	return count;
};

SocketRooms.getLocalStats = (callback) => {
	var io = require('../index').server;

	var socketData = {
		onlineGuestCount: 0,
		onlineRegisteredCount: 0,
		socketCount: 0,
		users: {
			categories: 0,
			recent: 0,
			unread: 0,
			topics: 0,
			category: 0,
		},
		topics: {},
	};

	if (io) {
		var roomClients = io.sockets.adapter.rooms;
		socketData.onlineGuestCount = roomClients.online_guests ? roomClients.online_guests.length : 0;
		socketData.onlineRegisteredCount = SocketRooms.getOnlineUserCount(io);
		socketData.socketCount = Object.keys(io.sockets.sockets).length;
		socketData.users.categories = roomClients.categories ? roomClients.categories.length : 0;
		socketData.users.recent = roomClients.recent_topics ? roomClients.recent_topics.length : 0;
		socketData.users.unread = roomClients.unread_topics ? roomClients.unread_topics.length : 0;

		var topTenTopics = [];
		var tid;

		for (var room in roomClients) {
			if (roomClients.hasOwnProperty(room)) {
				tid = room.match(/^topic_(\d+)/);
				if (tid) {
					socketData.users.topics += roomClients[room].length;
					topTenTopics.push({ tid: tid[1], count: roomClients[room].length });
				} else if (room.match(/^category/)) {
					socketData.users.category += roomClients[room].length;
				}
			}
		}

		topTenTopics = topTenTopics.sort((a, b) => b.count - a.count).slice(0, 10);

		socketData.topics = topTenTopics;
	}

	callback(null, socketData);
};
