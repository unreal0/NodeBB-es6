

var async = require('async');
var validator = require('validator');
var winston = require('winston');

var db = require('../database');

module.exports = (Categories) => {
	Categories.getCategoryData = (cid, callback) => {
		async.waterfall([
			(next) => {
				db.getObject('category:' + cid, next);
			},
			(category, next) => {
				modifyCategory(category);
				next(null, category);
			},
		], callback);
	};

	Categories.getCategoriesData = (cids, callback) => {
		Categories.getCategoriesFields(cids, [], callback);
	};

	function modifyCategory(category) {
		if (!category) {
			return;
		}

		category.name = validator.escape(String(category.name || ''));
		category.disabled = category.hasOwnProperty('disabled') ? parseInt(category.disabled, 10) === 1 : undefined;
		category.isSection = category.hasOwnProperty('isSection') ? parseInt(category.isSection, 10) === 1 : undefined;

		if (category.hasOwnProperty('icon')) {
			category.icon = category.icon || 'hidden';
		}

		if (category.hasOwnProperty('post_count')) {
			category.post_count = category.post_count || 0;
			category.totalPostCount = category.post_count;
		}

		if (category.hasOwnProperty('topic_count')) {
			category.topic_count = category.topic_count || 0;
			category.totalTopicCount = category.topic_count;
		}

		if (category.image) {
			category.backgroundImage = category.image;
		}

		if (category.description) {
			category.description = validator.escape(String(category.description));
			category.descriptionParsed = category.descriptionParsed || category.description;
		}
	}

	Categories.getCategoryField = (cid, field, callback) => {
		db.getObjectField('category:' + cid, field, callback);
	};

	Categories.getCategoriesFields = (cids, fields, callback) => {
		if (!Array.isArray(cids) || !cids.length) {
			return callback(null, []);
		}

		var keys = cids.map(cid => 'category:' + cid);
		async.waterfall([
			(next) => {
				if (fields.length) {
					db.getObjectsFields(keys, fields, next);
				} else {
					db.getObjects(keys, next);
				}
			},
			(categories, next) => {
				categories.forEach(modifyCategory);
				next(null, categories);
			},
		], callback);
	};

	Categories.getMultipleCategoryFields = (cids, fields, callback) => {
		winston.warn('[deprecated] Categories.getMultipleCategoryFields is deprecated please use Categories.getCategoriesFields');
		Categories.getCategoriesFields(cids, fields, callback);
	};

	Categories.getAllCategoryFields = (fields, callback) => {
		async.waterfall([
			async.apply(db.getSortedSetRange, 'categories:cid', 0, -1),
			(cids, next) => {
				Categories.getCategoriesFields(cids, fields, next);
			},
		], callback);
	};

	Categories.getCategoryFields = (cid, fields, callback) => {
		db.getObjectFields('category:' + cid, fields, callback);
	};

	Categories.setCategoryField = (cid, field, value, callback) => {
		db.setObjectField('category:' + cid, field, value, callback);
	};

	Categories.incrementCategoryFieldBy = (cid, field, value, callback) => {
		db.incrObjectFieldBy('category:' + cid, field, value, callback);
	};
};
