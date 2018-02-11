var async = require('async');

var topics = require('../topics');
var posts = require('../posts');
var websockets = require('./index');
var user = require('../user');
var apiController = require('../controllers/api');
var socketHelpers = require('./helpers');

var SocketTopics = module.exports;

require('./topics/unread')(SocketTopics);
require('./topics/move')(SocketTopics);
require('./topics/tools')(SocketTopics);
require('./topics/infinitescroll')(SocketTopics);
require('./topics/tags')(SocketTopics);
require('./topics/merge')(SocketTopics);

SocketTopics.post = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	data.uid = socket.uid;
	data.req = websockets.reqFromSocket(socket);
	data.timestamp = Date.now();

	async.waterfall([
		(next) => {
			posts.shouldQueue(socket.uid, data, next);
		},
		(shouldQueue, next) => {
			if (shouldQueue) {
				posts.addToQueue(data, next);
			} else {
				postTopic(socket, data, next);
			}
		},
	], callback);
};

function postTopic(socket, data, callback) {
	async.waterfall([
		(next) => {
			topics.post(data, next);
		},
		(result, next) => {
			next(null, result.topicData);

			socket.emit('event:new_post', { posts: [result.postData] });
			socket.emit('event:new_topic', result.topicData);

			socketHelpers.notifyNew(socket.uid, 'newTopic', { posts: [result.postData], topic: result.topicData });
		},
	], callback);
}

SocketTopics.postcount = (socket, tid, callback) => {
	topics.getTopicField(tid, 'postcount', callback);
};

SocketTopics.bookmark = (socket, data, callback) => {
	if (!socket.uid || !data) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	topics.setUserBookmark(data.tid, socket.uid, data.index, callback);
};

SocketTopics.createTopicFromPosts = (socket, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:not-logged-in]]'));
	}

	if (!data || !data.title || !data.pids || !Array.isArray(data.pids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	topics.createTopicFromPosts(socket.uid, data.title, data.pids, data.fromTid, callback);
};

SocketTopics.changeWatching = (socket, data, callback) => {
	if (!data || !data.tid || !data.type) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var commands = ['follow', 'unfollow', 'ignore'];
	if (commands.indexOf(data.type) === -1) {
		return callback(new Error('[[error:invalid-command]]'));
	}
	followCommand(topics[data.type], socket, data.tid, callback);
};

SocketTopics.follow = (socket, tid, callback) => {
	followCommand(topics.follow, socket, tid, callback);
};

function followCommand(method, socket, tid, callback) {
	if (!socket.uid) {
		return callback(new Error('[[error:not-logged-in]]'));
	}

	method(tid, socket.uid, callback);
}

SocketTopics.isFollowed = (socket, tid, callback) => {
	topics.isFollowing([tid], socket.uid, (err, isFollowing) => {
		callback(err, Array.isArray(isFollowing) && isFollowing.length ? isFollowing[0] : false);
	});
};

SocketTopics.search = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	topics.search(data.tid, data.term, callback);
};

SocketTopics.isModerator = (socket, tid, callback) => {
	async.waterfall([
		(next) => {
			topics.getTopicField(tid, 'cid', next);
		},
		(cid, next) => {
			user.isModerator(socket.uid, cid, next);
		},
	], callback);
};

SocketTopics.getTopic = (socket, tid, callback) => {
	apiController.getTopicData(tid, socket.uid, callback);
};
