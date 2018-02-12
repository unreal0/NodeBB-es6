var async = require('async');

var db = require('../database');
var meta = require('../meta');
var utils = require('../utils');
var translator = require('../translator');
var plugins = require('../plugins');

module.exports = (Categories) => {
	Categories.update = (modified, callback) => {
		var cids = Object.keys(modified);

		async.each(cids, (cid, next) => {
			updateCategory(cid, modified[cid], next);
		}, (err) => {
			callback(err, cids);
		});
	};

	function updateCategory(cid, modifiedFields, callback) {
		var category;
		async.waterfall([
			(next) => {
				Categories.exists(cid, next);
			},
			(exists, next) => {
				if (!exists) {
					return callback();
				}

				if (modifiedFields.hasOwnProperty('name')) {
					translator.translate(modifiedFields.name, (translated) => {
						modifiedFields.slug = cid + '/' + utils.slugify(translated);
						next();
					});
				} else {
					next();
				}
			},
			(next) => {
				plugins.fireHook('filter:category.update', { category: modifiedFields }, next);
			},
			(categoryData, next) => {
				category = categoryData.category;
				var fields = Object.keys(category);
				// move parent to front, so its updated first
				var parentCidIndex = fields.indexOf('parentCid');
				if (parentCidIndex !== -1 && fields.length > 1) {
					fields.splice(0, 0, fields.splice(parentCidIndex, 1)[0]);
				}

				async.eachSeries(fields, (key, next) => {
					updateCategoryField(cid, key, category[key], next);
				}, next);
			},
			(next) => {
				plugins.fireHook('action:category.update', { cid: cid, modified: category });
				next();
			},
		], callback);
	}

	function updateCategoryField(cid, key, value, callback) {
		if (key === 'parentCid') {
			return updateParent(cid, value, callback);
		} else if (key === 'tagWhitelist') {
			return updateTagWhitelist(cid, value, callback);
		}

		async.waterfall([
			(next) => {
				db.setObjectField('category:' + cid, key, value, next);
			},
			(next) => {
				if (key === 'order') {
					updateOrder(cid, value, next);
				} else if (key === 'description') {
					Categories.parseDescription(cid, value, next);
				} else {
					next();
				}
			},
		], callback);
	}

	function updateParent(cid, newParent, callback) {
		if (parseInt(cid, 10) === parseInt(newParent, 10)) {
			return callback(new Error('[[error:cant-set-self-as-parent]]'));
		}
		async.waterfall([
			(next) => {
				Categories.getCategoryField(cid, 'parentCid', next);
			},
			(oldParent, next) => {
				async.series([
					(next) => {
						oldParent = parseInt(oldParent, 10) || 0;
						db.sortedSetRemove('cid:' + oldParent + ':children', cid, next);
					},
					(next) => {
						newParent = parseInt(newParent, 10) || 0;
						db.sortedSetAdd('cid:' + newParent + ':children', cid, cid, next);
					},
					(next) => {
						db.setObjectField('category:' + cid, 'parentCid', newParent, next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	}

	function updateTagWhitelist(cid, tags, callback) {
		tags = tags.split(',');
		tags = tags.map(tag => utils.cleanUpTag(tag, meta.config.maximumTagLength)).filter(Boolean);

		async.waterfall([
			(next) => {
				db.delete('cid:' + cid + ':tag:whitelist', next);
			},
			(next) => {
				var scores = tags.map((tag, index) => index);
				db.sortedSetAdd('cid:' + cid + ':tag:whitelist', scores, tags, next);
			},
		], callback);
	}

	function updateOrder(cid, order, callback) {
		async.waterfall([
			(next) => {
				Categories.getCategoryField(cid, 'parentCid', next);
			},
			(parentCid, next) => {
				async.parallel([
					(next) => {
						db.sortedSetAdd('categories:cid', order, cid, next);
					},
					(next) => {
						parentCid = parseInt(parentCid, 10) || 0;
						db.sortedSetAdd('cid:' + parentCid + ':children', order, cid, next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	}

	Categories.parseDescription = (cid, description, callback) => {
		async.waterfall([
			(next) => {
				plugins.fireHook('filter:parse.raw', description, next);
			},
			(parsedDescription, next) => {
				Categories.setCategoryField(cid, 'descriptionParsed', parsedDescription, next);
			},
		], callback);
	};
};
