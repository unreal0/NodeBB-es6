var async = require('async');
var _ = require('lodash');

var categories = require('../categories');
var search = require('../search');

module.exports = (Topics) => {
	Topics.getSuggestedTopics = (tid, uid, start, stop, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					tagTids: (next) => {
						getTidsWithSameTags(tid, next);
					},
					searchTids: (next) => {
						getSearchTids(tid, next);
					},
					categoryTids: (next) => {
						getCategoryTids(tid, next);
					},
				}, next);
			},
			(results, next) => {
				var tids = results.tagTids.concat(results.searchTids).concat(results.categoryTids);
				tids = _.uniq(tids).filter(_tid => parseInt(_tid, 10) !== parseInt(tid, 10));

				if (stop === -1) {
					tids = tids.slice(start);
				} else {
					tids = tids.slice(start, stop + 1);
				}

				Topics.getTopics(tids, uid, next);
			},
		], callback);
	};

	function getTidsWithSameTags(tid, callback) {
		async.waterfall([
			(next) => {
				Topics.getTopicTags(tid, next);
			},
			(tags, next) => {
				async.map(tags, (tag, next) => {
					Topics.getTagTids(tag, 0, -1, next);
				}, next);
			},
			(data, next) => {
				next(null, _.uniq(_.flatten(data)));
			},
		], callback);
	}

	function getSearchTids(tid, callback) {
		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'title', next);
			},
			(title, next) => {
				search.searchQuery('topic', title, [], [], next);
			},
		], callback);
	}

	function getCategoryTids(tid, callback) {
		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'cid', next);
			},
			(cid, next) => {
				categories.getTopicIds({
					cid: cid,
					start: 0,
					stop: 9,
				}, next);
			},
		], callback);
	}
};
