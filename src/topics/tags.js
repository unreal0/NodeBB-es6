var async = require('async');
var validator = require('validator');

var db = require('../database');
var meta = require('../meta');
var _ = require('lodash');
var plugins = require('../plugins');
var utils = require('../utils');
var batch = require('../batch');

module.exports = (Topics) => {
	Topics.createTags = (tags, tid, timestamp, callback) => {
		callback = callback || function () {};

		if (!Array.isArray(tags) || !tags.length) {
			return callback();
		}

		async.waterfall([
			(next) => {
				plugins.fireHook('filter:tags.filter', { tags: tags, tid: tid }, next);
			},
			(data, next) => {
				tags = _.uniq(data.tags);
				tags = tags.slice(0, meta.config.maximumTagsPerTopic || 5);
				tags = tags.map(tag => utils.cleanUpTag(tag, meta.config.maximumTagLength)).filter(tag => tag && tag.length >= (meta.config.minimumTagLength || 3));

				filterCategoryTags(tags, tid, next);
			},
			(_tags, next) => {
				tags = _tags;
				var keys = tags.map(tag => 'tag:' + tag + ':topics');

				async.parallel([
					async.apply(db.setAdd, 'topic:' + tid + ':tags', tags),
					async.apply(db.sortedSetsAdd, keys, timestamp, tid),
				], (err) => {
					next(err);
				});
			},
			(next) => {
				async.each(tags, updateTagCount, next);
			},
		], callback);
	};

	function filterCategoryTags(tags, tid, callback) {
		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'cid', next);
			},
			(cid, next) => {
				db.getSortedSetRange('cid:' + cid + ':tag:whitelist', 0, -1, next);
			},
			(tagWhitelist, next) => {
				if (!tagWhitelist.length) {
					return next(null, tags);
				}
				tags = tags.filter(tag => tagWhitelist.indexOf(tag) !== -1);
				next(null, tags);
			},
		], callback);
	}

	Topics.createEmptyTag = (tag, callback) => {
		if (!tag) {
			return callback(new Error('[[error:invalid-tag]]'));
		}

		tag = utils.cleanUpTag(tag, meta.config.maximumTagLength);
		if (tag.length < (meta.config.minimumTagLength || 3)) {
			return callback(new Error('[[error:tag-too-short]]'));
		}

		async.waterfall([
			(next) => {
				db.isSortedSetMember('tags:topic:count', tag, next);
			},
			(isMember, next) => {
				if (isMember) {
					return next();
				}
				db.sortedSetAdd('tags:topic:count', 0, tag, next);
			},
		], callback);
	};

	Topics.updateTags = (data, callback) => {
		async.eachSeries(data, (tagData, next) => {
			db.setObject('tag:' + tagData.value, {
				color: tagData.color,
				bgColor: tagData.bgColor,
			}, next);
		}, callback);
	};

	Topics.renameTags = (data, callback) => {
		async.eachSeries(data, (tagData, next) => {
			renameTag(tagData.value, tagData.newName, next);
		}, callback);
	};

	function renameTag(tag, newTagName, callback) {
		if (!newTagName || tag === newTagName) {
			return setImmediate(callback);
		}
		async.waterfall([
			(next) => {
				Topics.createEmptyTag(newTagName, next);
			},
			(next) => {
				batch.processSortedSet('tag:' + tag + ':topics', (tids, next) => {
					async.waterfall([
						(next) => {
							db.sortedSetScores('tag:' + tag + ':topics', tids, next);
						},
						(scores, next) => {
							db.sortedSetAdd('tag:' + newTagName + ':topics', scores, tids, next);
						},
						(next) => {
							var keys = tids.map(tid => 'topic:' + tid + ':tags');

							async.series([
								async.apply(db.sortedSetRemove, 'tag:' + tag + ':topics', tids),
								async.apply(db.setsRemove, keys, tag),
								async.apply(db.setsAdd, keys, newTagName),
							], next);
						},
					], next);
				}, next);
			},
			(next) => {
				Topics.deleteTag(tag, next);
			},
			(next) => {
				updateTagCount(newTagName, next);
			},
		], callback);
	}

	function updateTagCount(tag, callback) {
		callback = callback || function () {};
		async.waterfall([
			(next) => {
				Topics.getTagTopicCount(tag, next);
			},
			(count, next) => {
				count = count || 0;

				db.sortedSetAdd('tags:topic:count', count, tag, next);
			},
		], callback);
	}

	Topics.getTagTids = (tag, start, stop, callback) => {
		db.getSortedSetRevRange('tag:' + tag + ':topics', start, stop, callback);
	};

	Topics.getTagTopicCount = (tag, callback) => {
		db.sortedSetCard('tag:' + tag + ':topics', callback);
	};

	Topics.deleteTags = (tags, callback) => {
		if (!Array.isArray(tags) || !tags.length) {
			return callback();
		}

		async.series([
			(next) => {
				removeTagsFromTopics(tags, next);
			},
			(next) => {
				var keys = tags.map(tag => 'tag:' + tag + ':topics');
				db.deleteAll(keys, next);
			},
			(next) => {
				db.sortedSetRemove('tags:topic:count', tags, next);
			},
			(next) => {
				db.deleteAll(tags.map(tag => 'tag:' + tag), next);
			},
		], (err) => {
			callback(err);
		});
	};

	function removeTagsFromTopics(tags, callback) {
		async.eachLimit(tags, 50, (tag, next) => {
			db.getSortedSetRange('tag:' + tag + ':topics', 0, -1, (err, tids) => {
				if (err || !tids.length) {
					return next(err);
				}
				var keys = tids.map(tid => 'topic:' + tid + ':tags');

				db.setsRemove(keys, tag, next);
			});
		}, callback);
	}

	Topics.deleteTag = (tag, callback) => {
		Topics.deleteTags([tag], callback);
	};

	Topics.getTags = (start, stop, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRangeWithScores('tags:topic:count', start, stop, next);
			},
			(tags, next) => {
				Topics.getTagData(tags, next);
			},
		], callback);
	};

	Topics.getTagData = (tags, callback) => {
		var keys = tags.map(tag => 'tag:' + tag.value);

		async.waterfall([
			(next) => {
				db.getObjects(keys, next);
			},
			(tagData, next) => {
				tags.forEach((tag, index) => {
					tag.valueEscaped = validator.escape(String(tag.value));
					tag.color = tagData[index] ? tagData[index].color : '';
					tag.bgColor = tagData[index] ? tagData[index].bgColor : '';
				});
				next(null, tags);
			},
		], callback);
	};

	Topics.getTopicTags = (tid, callback) => {
		db.getSetMembers('topic:' + tid + ':tags', callback);
	};

	Topics.getTopicsTags = (tids, callback) => {
		var keys = tids.map(tid => 'topic:' + tid + ':tags');
		db.getSetsMembers(keys, callback);
	};

	Topics.getTopicTagsObjects = (tid, callback) => {
		Topics.getTopicsTagsObjects([tid], (err, data) => {
			callback(err, Array.isArray(data) && data.length ? data[0] : []);
		});
	};

	Topics.getTopicsTagsObjects = (tids, callback) => {
		var sets = tids.map(tid => 'topic:' + tid + ':tags');
		var uniqueTopicTags;
		var topicTags;
		async.waterfall([
			(next) => {
				db.getSetsMembers(sets, next);
			},
			(_topicTags, next) => {
				topicTags = _topicTags;
				uniqueTopicTags = _.uniq(_.flatten(topicTags));

				var tags = uniqueTopicTags.map(tag => ({ value: tag }));

				async.parallel({
					tagData: (next) => {
						Topics.getTagData(tags, next);
					},
					counts: (next) => {
						db.sortedSetScores('tags:topic:count', uniqueTopicTags, next);
					},
				}, next);
			},
			(results, next) => {
				results.tagData.forEach((tag, index) => {
					tag.score = results.counts[index] ? results.counts[index] : 0;
				});

				var tagData = _.zipObject(uniqueTopicTags, results.tagData);

				topicTags.forEach((tags, index) => {
					if (Array.isArray(tags)) {
						topicTags[index] = tags.map(tag => tagData[tag]);
						topicTags[index].sort((tag1, tag2) => tag2.score - tag1.score);
					}
				});

				next(null, topicTags);
			},
		], callback);
	};

	Topics.updateTopicTags = (tid, tags, callback) => {
		callback = callback || function () {};
		async.waterfall([
			(next) => {
				Topics.deleteTopicTags(tid, next);
			},
			(next) => {
				Topics.getTopicField(tid, 'timestamp', next);
			},
			(timestamp, next) => {
				Topics.createTags(tags, tid, timestamp, next);
			},
		], callback);
	};

	Topics.deleteTopicTags = (tid, callback) => {
		async.waterfall([
			(next) => {
				Topics.getTopicTags(tid, next);
			},
			(tags, next) => {
				async.series([
					(next) => {
						db.delete('topic:' + tid + ':tags', next);
					},
					(next) => {
						var sets = tags.map(tag => 'tag:' + tag + ':topics');

						db.sortedSetsRemove(sets, tid, next);
					},
					(next) => {
						async.each(tags, (tag, next) => {
							updateTagCount(tag, next);
						}, next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	};

	Topics.searchTags = (data, callback) => {
		if (!data || !data.query) {
			return callback(null, []);
		}

		async.waterfall([
			(next) => {
				if (plugins.hasListeners('filter:topics.searchTags')) {
					plugins.fireHook('filter:topics.searchTags', { data: data }, next);
				} else {
					findMatches(data.query, 0, next);
				}
			},
			(result, next) => {
				plugins.fireHook('filter:tags.search', { data: data, matches: result.matches }, next);
			},
			(result, next) => {
				next(null, result.matches);
			},
		], callback);
	};

	Topics.autocompleteTags = (data, callback) => {
		if (!data || !data.query) {
			return callback(null, []);
		}

		async.waterfall([
			(next) => {
				if (plugins.hasListeners('filter:topics.autocompleteTags')) {
					plugins.fireHook('filter:topics.autocompleteTags', { data: data }, next);
				} else {
					findMatches(data.query, data.cid, next);
				}
			},
			(result, next) => {
				next(null, result.matches);
			},
		], callback);
	};

	function findMatches(query, cid, callback) {
		async.waterfall([
			(next) => {
				if (parseInt(cid, 10)) {
					db.getSortedSetRange('cid:' + cid + ':tag:whitelist', 0, -1, next);
				} else {
					setImmediate(next, null, []);
				}
			},
			(tagWhitelist, next) => {
				if (tagWhitelist.length) {
					setImmediate(next, null, tagWhitelist);
				} else {
					db.getSortedSetRevRange('tags:topic:count', 0, -1, next);
				}
			},
			(tags, next) => {
				query = query.toLowerCase();

				var matches = [];
				for (var i = 0; i < tags.length; i += 1) {
					if (tags[i].toLowerCase().startsWith(query)) {
						matches.push(tags[i]);
						if (matches.length > 19) {
							break;
						}
					}
				}

				matches = matches.sort((a, b) => a > b);
				next(null, { matches: matches });
			},
		], callback);
	}

	Topics.searchAndLoadTags = (data, callback) => {
		var searchResult = {
			tags: [],
			matchCount: 0,
			pageCount: 1,
		};

		if (!data || !data.query || !data.query.length) {
			return callback(null, searchResult);
		}
		async.waterfall([
			(next) => {
				Topics.searchTags(data, next);
			},
			(tags, next) => {
				async.parallel({
					counts: (next) => {
						db.sortedSetScores('tags:topic:count', tags, next);
					},
					tagData: (next) => {
						tags = tags.map(tag => ({ value: tag }));

						Topics.getTagData(tags, next);
					},
				}, next);
			},
			(results, next) => {
				results.tagData.forEach((tag, index) => {
					tag.score = results.counts[index];
				});
				results.tagData.sort((a, b) => b.score - a.score);
				searchResult.tags = results.tagData;
				searchResult.matchCount = results.tagData.length;
				searchResult.pageCount = 1;
				next(null, searchResult);
			},
		], callback);
	};

	Topics.getRelatedTopics = (topicData, uid, callback) => {
		if (plugins.hasListeners('filter:topic.getRelatedTopics')) {
			return plugins.fireHook('filter:topic.getRelatedTopics', { topic: topicData, uid: uid }, callback);
		}

		var maximumTopics = parseInt(meta.config.maximumRelatedTopics, 10) || 0;
		if (maximumTopics === 0 || !topicData.tags || !topicData.tags.length) {
			return callback(null, []);
		}

		maximumTopics = maximumTopics || 5;

		async.waterfall([
			(next) => {
				async.map(topicData.tags, (tag, next) => {
					Topics.getTagTids(tag.value, 0, 5, next);
				}, next);
			},
			(tids, next) => {
				tids = _.shuffle(_.uniq(_.flatten(tids))).slice(0, maximumTopics);
				Topics.getTopics(tids, uid, next);
			},
			(topics, next) => {
				topics = topics.filter(topic => topic && !topic.deleted && parseInt(topic.uid, 10) !== parseInt(uid, 10));
				next(null, topics);
			},
		], callback);
	};
};
