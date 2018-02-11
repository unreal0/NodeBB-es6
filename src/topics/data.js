var async = require('async');
var validator = require('validator');

var db = require('../database');
var categories = require('../categories');
var utils = require('../utils');
var translator = require('../translator');

function escapeTitle(topicData) {
	if (!topicData) {
		return;
	}
	if (topicData.title) {
		topicData.title = translator.escape(validator.escape(topicData.title.toString()));
	}
	if (topicData.titleRaw) {
		topicData.titleRaw = translator.escape(topicData.titleRaw);
	}
}

module.exports = (Topics) => {
	Topics.getTopicField = (tid, field, callback) => {
		async.waterfall([
			(next) => {
				db.getObjectField('topic:' + tid, field, next);
			},
			(value, next) => {
				if (field === 'title') {
					value = translator.escape(validator.escape(String(value)));
				}
				next(null, value);
			},
		], callback);
	};

	Topics.getTopicFields = (tid, fields, callback) => {
		async.waterfall([
			(next) => {
				db.getObjectFields('topic:' + tid, fields, next);
			},
			(topic, next) => {
				escapeTitle(topic);
				next(null, topic);
			},
		], callback);
	};

	Topics.getTopicsFields = (tids, fields, callback) => {
		if (!Array.isArray(tids) || !tids.length) {
			return callback(null, []);
		}
		var keys = tids.map(tid => 'topic:' + tid);
		async.waterfall([
			(next) => {
				if (fields.length) {
					db.getObjectsFields(keys, fields, next);
				} else {
					db.getObjects(keys, next);
				}
			},
			(topics, next) => {
				topics.forEach(modifyTopic);
				next(null, topics);
			},
		], callback);
	};

	Topics.getTopicData = (tid, callback) => {
		async.waterfall([
			(next) => {
				db.getObject('topic:' + tid, next);
			},
			(topic, next) => {
				if (!topic) {
					return next(null, null);
				}
				modifyTopic(topic);
				next(null, topic);
			},
		], callback);
	};

	Topics.getTopicsData = (tids, callback) => {
		Topics.getTopicsFields(tids, [], callback);
	};

	function modifyTopic(topic) {
		if (!topic) {
			return;
		}

		topic.titleRaw = topic.title;
		topic.title = String(topic.title);
		escapeTitle(topic);
		topic.timestampISO = utils.toISOString(topic.timestamp);
		topic.lastposttimeISO = utils.toISOString(topic.lastposttime);
	}

	Topics.getCategoryData = (tid, callback) => {
		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'cid', next);
			},
			(cid, next) => {
				categories.getCategoryData(cid, next);
			},
		], callback);
	};

	Topics.setTopicField = (tid, field, value, callback) => {
		db.setObjectField('topic:' + tid, field, value, callback);
	};

	Topics.setTopicFields = (tid, data, callback) => {
		callback = callback || function () {};
		db.setObject('topic:' + tid, data, callback);
	};

	Topics.deleteTopicField = (tid, field, callback) => {
		db.deleteObjectField('topic:' + tid, field, callback);
	};

	Topics.deleteTopicFields = (tid, fields, callback) => {
		db.deleteObjectFields('topic:' + tid, fields, callback);
	};
};
