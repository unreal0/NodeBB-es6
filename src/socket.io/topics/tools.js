var async = require('async');

var topics = require('../../topics');
var events = require('../../events');
var privileges = require('../../privileges');
var plugins = require('../../plugins');
var socketHelpers = require('../helpers');

module.exports = (SocketTopics) => {
	SocketTopics.loadTopicTools = (socket, data, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}
		if (!data) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		var topic;
		async.waterfall([
			(next) => {
				async.parallel({
					topic: (next) => {
						topics.getTopicData(data.tid, next);
					},
					privileges: (next) => {
						privileges.topics.get(data.tid, socket.uid, next);
					},
				}, next);
			},
			(results, next) => {
				topic = results.topic;
				topic.privileges = results.privileges;
				plugins.fireHook('filter:topic.thread_tools', { topic: results.topic, uid: socket.uid, tools: [] }, next);
			},
			(data, next) => {
				topic.deleted = parseInt(topic.deleted, 10) === 1;
				topic.locked = parseInt(topic.locked, 10) === 1;
				topic.pinned = parseInt(topic.pinned, 10) === 1;
				topic.thread_tools = data.tools;
				next(null, topic);
			},
		], callback);
	};

	SocketTopics.delete = (socket, data, callback) => {
		SocketTopics.doTopicAction('delete', 'event:topic_deleted', socket, data, callback);
	};

	SocketTopics.restore = (socket, data, callback) => {
		SocketTopics.doTopicAction('restore', 'event:topic_restored', socket, data, callback);
	};

	SocketTopics.purge = (socket, data, callback) => {
		SocketTopics.doTopicAction('purge', 'event:topic_purged', socket, data, callback);
	};

	SocketTopics.lock = (socket, data, callback) => {
		SocketTopics.doTopicAction('lock', 'event:topic_locked', socket, data, callback);
	};

	SocketTopics.unlock = (socket, data, callback) => {
		SocketTopics.doTopicAction('unlock', 'event:topic_unlocked', socket, data, callback);
	};

	SocketTopics.pin = (socket, data, callback) => {
		SocketTopics.doTopicAction('pin', 'event:topic_pinned', socket, data, callback);
	};

	SocketTopics.unpin = (socket, data, callback) => {
		SocketTopics.doTopicAction('unpin', 'event:topic_unpinned', socket, data, callback);
	};

	SocketTopics.doTopicAction = (action, event, socket, data, callback) => {
		callback = callback || function () {};
		if (!socket.uid) {
			return callback(new Error('[[error:no-privileges]]'));
		}

		if (!data || !Array.isArray(data.tids) || !data.cid) {
			return callback(new Error('[[error:invalid-tid]]'));
		}

		if (typeof topics.tools[action] !== 'function') {
			return callback();
		}

		async.each(data.tids, (tid, next) => {
			var title;
			async.waterfall([
				(next) => {
					topics.getTopicField(tid, 'title', next);
				},
				(_title, next) => {
					title = _title;
					topics.tools[action](tid, socket.uid, next);
				},
				(data, next) => {
					socketHelpers.emitToTopicAndCategory(event, data);
					logTopicAction(action, socket, tid, title, next);
				},
			], next);
		}, callback);
	};

	function logTopicAction(action, socket, tid, title, callback) {
		var actionsToLog = ['delete', 'restore', 'purge'];
		if (actionsToLog.indexOf(action) === -1) {
			return setImmediate(callback);
		}
		events.log({
			type: 'topic-' + action,
			uid: socket.uid,
			ip: socket.ip,
			tid: tid,
			title: String(title),
		}, callback);
	}

	SocketTopics.orderPinnedTopics = (socket, data, callback) => {
		if (!Array.isArray(data)) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		topics.tools.orderPinnedTopics(socket.uid, data, callback);
	};
};
