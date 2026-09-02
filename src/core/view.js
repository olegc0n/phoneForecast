/* view.js - the render layer, behaviour-identical to the original update().
 *
 * Every element carrying .value is registered once, with the write mode taken
 * from its data-type attribute. Writes are diffed, so a minute tick touches
 * two nodes rather than forty. A field's wrapper (.sector_<id>) only becomes
 * visible once real data has arrived for it, and goes back to invisible when
 * that data expires - which is what makes a dead API look deliberate rather
 * than broken.                                                                 */

var View = (function () {
	var value = {};

	function register() {
		each(qsa('.value'), function (el) {
			var id = el.getAttribute('id');
			if (!id) return;
			value[id] = {
				visible: 0,
				data: null,
				update: 0,
				type: el.hasAttribute('data-type') ? el.getAttribute('data-type') : 'value'
			};
		});
	}

	function update(result, now) {
		for (var id in value) {
			if (result.hasOwnProperty(id)) {
				var text = String(result[id]).replace(/['"\\<>]/g, '');
				var slot = value[id];

				if (text !== slot.data) {
					var el = byId(id);
					if (el) {
						switch (slot.type) {
							case 'value':
								el.innerHTML = text;
								break;
							case 'class':
								removeClass(el, slot.data);
								addClass(el, text);
								break;
							case 'style':
								el.setAttribute('style', text);
								break;
						}
					}
					slot.data = text;
				}

				slot.update = now;
				if (slot.visible === 0) {
					slot.visible = 1;
					addClassAll('.sector_' + id, 'visible');
				}
			}

			if (value[id].update < (now - expire * 1000)) {
				if (value[id].visible === 1) {
					value[id].visible = 0;
					removeClassAll('.sector_' + id, 'visible');
				}
			}
		}
	}

	return {
		register: register,
		update: update,
		has: function (id) { return value.hasOwnProperty(id); },
		data: function (id) { return value[id] ? value[id].data : null; }
	};
})();
