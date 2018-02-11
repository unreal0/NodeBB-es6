var async = require('async');
var topics = require('../../topics');
var categories = require('../../categories');
var privileges = require('../../privileges');
var socketHelpers = require('../helpers');

module.exports = (SocketTopics) => {
	SocketTopics.move = (socket, data, callback) => {
		if (!data || !Array.isArray(data.tids) || !data.cid) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.eachLimit(data.tids, 10, (tid, next) => {
			var topicData;
			async.waterfall([
				(next) => {
					privileges.topics.isAdminOrMod(tid, socket.uid, next);
				},
				(canMove, next) => {
					if (!canMove) {
						return next(new Error('[[error:no-privileges]]'));
					}

					topics.getTopicFields(tid, ['cid', 'slug'], next);
				},
				(_topicData, next) => {
					topicData = _topicData;
					topicData.tid = tid;
					data.uid = socket.uid;
					topics.tools.move(tid, data, next);
				},
				(next) => {
					socketHelpers.emitToTopicAndCategory('event:topic_moved', topicData);

					socketHelpers.sendNotificationToTopicOwner(tid, socket.uid, 'move', 'notifications:moved_your_topic');

					next();
				},
			], next);
		}, callback);
	};


	SocketTopics.moveAll = (socket, data, callback) => {
		if (!data || !data.cid || !data.currentCid) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			(next) => {
				privileges.categories.canMoveAllTopics(data.currentCid, data.cid, socket.uid, next);
			},
			(canMove, next) => {
				if (!canMove) {
					return callback(new Error('[[error:no-privileges]]'));
				}

				categories.getAllTopicIds(data.currentCid, 0, -1, next);
			},
			(tids, next) => {
				data.uid = socket.uid;
				async.eachLimit(tids, 50, (tid, next) => {
					topics.tools.move(tid, data, next);
				}, next);
			},
		], callback);
	};
};
