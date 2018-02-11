var async = require('async');
var posts = require('../../posts');
var plugins = require('../../plugins');
var websockets = require('../index');
var socketHelpers = require('../helpers');

var helpers = module.exports;

helpers.postCommand = (socket, command, eventName, notification, data, callback) => {
	if (!socket.uid) {
		return callback(new Error('[[error:not-logged-in]]'));
	}

	if (!data || !data.pid) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	if (!data.room_id) {
		return callback(new Error('[[error:invalid-room-id, ' + data.room_id + ' ]]'));
	}

	async.waterfall([
		(next) => {
			async.parallel({
				exists: (next) => {
					posts.exists(data.pid, next);
				},
				deleted: (next) => {
					posts.getPostField(data.pid, 'deleted', next);
				},
			}, next);
		},
		(results, next) => {
			if (!results.exists) {
				return next(new Error('[[error:invalid-pid]]'));
			}

			if (parseInt(results.deleted, 10) === 1) {
				return next(new Error('[[error:post-deleted]]'));
			}

			/*
			hooks:
				filter:post.upvote
				filter:post.downvote
				filter:post.unvote
				filter:post.bookmark
				filter:post.unbookmark
			 */
			plugins.fireHook('filter:post.' + command, { data: data, uid: socket.uid }, next);
		},
		(filteredData, next) => {
			executeCommand(socket, command, eventName, notification, filteredData.data, next);
		},
	], callback);
};

function executeCommand(socket, command, eventName, notification, data, callback) {
	async.waterfall([
		(next) => {
			posts[command](data.pid, socket.uid, next);
		},
		(result, next) => {
			if (result && eventName) {
				websockets.in('uid_' + socket.uid).emit('posts.' + command, result);
				websockets.in(data.room_id).emit('event:' + eventName, result);
			}

			if (result && command === 'upvote') {
				socketHelpers.upvote(result, notification);
			} else if (result && notification) {
				socketHelpers.sendNotificationToPostOwner(data.pid, socket.uid, command, notification);
			} else if (result && command === 'unvote') {
				socketHelpers.rescindUpvoteNotification(data.pid, socket.uid);
			}
			next(null, result);
		},
	], callback);
}
