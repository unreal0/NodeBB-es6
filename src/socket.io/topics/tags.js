var async = require('async');
var db = require('../../database');
var topics = require('../../topics');
var utils = require('../../utils');

module.exports = (SocketTopics) => {
	SocketTopics.isTagAllowed = (socket, data, callback) => {
		if (!data || !utils.isNumber(data.cid) || !data.tag) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.waterfall([
			(next) => {
				db.getSortedSetRange('cid:' + data.cid + ':tag:whitelist', 0, -1, next);
			},
			(tagWhitelist, next) => {
				next(null, !tagWhitelist.length || tagWhitelist.includes(data.tag));
			},
		], callback);
	};

	SocketTopics.autocompleteTags = (socket, data, callback) => {
		topics.autocompleteTags(data, callback);
	};

	SocketTopics.searchTags = (socket, data, callback) => {
		topics.searchTags(data, callback);
	};

	SocketTopics.searchAndLoadTags = (socket, data, callback) => {
		topics.searchAndLoadTags(data, callback);
	};

	SocketTopics.loadMoreTags = (socket, data, callback) => {
		if (!data || !utils.isNumber(data.after)) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var start = parseInt(data.after, 10);
		var stop = start + 99;
		async.waterfall([
			(next) => {
				topics.getTags(start, stop, next);
			},
			(tags, next) => {
				tags = tags.filter(Boolean);
				next(null, { tags: tags, nextStart: stop + 1 });
			},
		], callback);
	};
};
