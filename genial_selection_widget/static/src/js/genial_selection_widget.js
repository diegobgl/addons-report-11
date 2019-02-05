odoo.define('genial_selection_widget', function(require) {
    "use strict";
    var AbstractField = require('web.AbstractField');
    var basicFields = require('web.basic_fields');
    var fieldRegistry = require('web.field_registry');
    var concurrency = require('web.concurrency');
    var ControlPanel = require('web.ControlPanel');
    var dialogs = require('web.view_dialogs');
    var core = require('web.core');
    var data = require('web.data');
    var Dialog = require('web.Dialog');
    var relational_fields = require('web.relational_fields');
    var KanbanRenderer = require('web.KanbanRenderer');
    var ListRenderer = require('web.ListRenderer');
    var Pager = require('web.Pager');

    var _t = core._t;
    var qweb = core.qweb;
    var session = require('web.session');
    var version = session.server_version_info;


    var M2ODialog = Dialog.extend({
        template: "M2ODialog",
        init: function (parent, name, value) {
            this.name = name;
            this.value = value;
            this._super(parent, {
                title: _.str.sprintf(_t("Create a %s"), this.name),
                size: 'medium',
                buttons: [{
                    text: _t('Create'),
                    classes: 'btn-primary',
                    click: function () {
                        if (this.$("input").val() !== ''){
                            this.trigger_up('quick_create', { value: this.$('input').val() });
                            this.close();
                        } else {
                            this.$("input").focus();
                        }
                    },
                }, {
                    text: _t('Create and edit'),
                    classes: 'btn-primary',
                    close: true,
                    click: function () {
                        this.trigger_up('search_create_popup', {
                            view_type: 'form',
                            value: this.$('input').val(),
                        });
                    },
                }, {
                    text: _t('Cancel'),
                    close: true,
                }],
            });
        },
        start: function () {
            this.$("p").text(_.str.sprintf(_t("You are creating a new %s, are you sure it does not exist yet?"), this.name));
            this.$("input").val(this.value);
        },
    });

    var GenialSelection = AbstractField.extend({
        supportedFieldTypes: ['integer'],
        template: 'FieldMany2One',
        custom_events: _.extend({}, AbstractField.prototype.custom_events, {
            'quick_create': '_onQuickCreate',
            'search_create_popup': '_onSearchCreatePopup',
        }),
        events: _.extend({}, AbstractField.prototype.events, {
            'click input': '_onInputClick',
            'focusout input': '_onInputFocusout',
            'keyup input': '_onInputKeyup',
            'click .o_external_button': '_onExternalButtonClick',
            'click': '_onClick',
        }),
        AUTOCOMPLETE_DELAY: 200,

        init: function () {
            this._super.apply(this, arguments);
            this.limit = 7;
            this.orderer = new concurrency.DropMisordered();

            // should normally also be set, except in standalone M20
            this.can_create = ('can_create' in this.attrs ? JSON.parse(this.attrs.can_create) : true) &&
                !this.nodeOptions.no_create;
            this.can_write = 'can_write' in this.attrs ? JSON.parse(this.attrs.can_write) : true;

            this.nodeOptions = _.defaults(this.nodeOptions, {
                quick_create: true,
            });
            this.value = false;
            this.abstract_value = false;
            this.m2o_value = this._formatValue(this.abstract_value);
            // 'recordParams' is a dict of params used when calling functions
            // 'getDomain' and 'getContext' on this.record
            this.recordParams = {fieldName: this.name, viewType: this.viewType};
            this.formatType = 'many2one';
        },
        start: function () {
            // booleean indicating that the content of the input isn't synchronized
            // with the current m2o value (for instance, the user is currently
            // typing something in the input, and hasn't selected a value yet).
            this.floating = false;

            this.$input = this.$('input');
            this.$external_button = this.$('.o_external_button');
            return this._super.apply(this, arguments);
        },

        //--------------------------------------------------------------------------
        // Public
        //--------------------------------------------------------------------------

        /**
         * @override
         * @returns {jQuery}
         */
        getFocusableElement: function () {
            return this.mode === 'edit' && this.$input || this.$el;
        },
        /**
         * TODO
         */
        reinitialize: function (value) {
            this.floating = false;
            this._setValue(value);
        },

        //--------------------------------------------------------------------------
        // Private
        //--------------------------------------------------------------------------

        /**
         * @private
         */
        _bindAutoComplete: function () {
            var self = this;
            this.$input.autocomplete({
                source: function (req, resp) {
                    self._search(req.term).then(function (result) {
                        resp(result);
                    });
                },
                select: function (event, ui) {
                    // we do not want the select event to trigger any additional
                    // effect, such as navigating to another field.
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    var item = ui.item;
                    self.floating = false;
                    if (item.id) {
                        self.reinitialize({id: item.id, display_name: item.name});
                    } else if (item.action) {
                        item.action();
                    }
                    return false;
                },
                focus: function (event) {
                    event.preventDefault(); // don't automatically select values on focus
                },
                close: function (event) {
                    // it is necessary to prevent ESC key from propagating to field
                    // root, to prevent unwanted discard operations.
                    if (event.which === $.ui.keyCode.ESCAPE) {
                        event.stopPropagation();
                    }
                },
                autoFocus: true,
                html: true,
                minLength: 0,
                delay: this.AUTOCOMPLETE_DELAY,
            });
            this.$input.autocomplete("option", "position", { my : "left top", at: "left bottom" });
            this.autocomplete_bound = true;
        },
        /**
         * @private
         * @param {string} [name]
         * @returns {Object}
         */
        _createContext: function (name) {
            var tmp = {};
            var field = this.nodeOptions.create_name_field;
            if (field === undefined) {
                field = "name";
            }
            if (field !== false && name && this.nodeOptions.quick_create !== false) {
                tmp["default_" + field] = name;
            }
            return tmp;
        },
        /**
         * @private
         * @returns {Array}
         */
        _getSearchBlacklist: function () {
            return [];
        },
        /**
        * Returns the display_name from a string which contains it but was altered
        * as a result of the show_address option using a horrible hack.
        *
        * @private
        * @param {string} value
        * @returns {string} display_name without show_address mess
        */
        _getDisplayName: function (value) {
            return value.split('\n')[0];
        },
        /**
         * @private
         * @param {string} name
         * @returns {Deferred} resolved after the name_create or when the slowcreate
         *                     modal is closed.
         */
        _quickCreate: function (name) {
            var self = this;
            var def = $.Deferred();
            var slowCreate = function () {
                var dialog = self._searchCreatePopup("form", false, self._createContext(name));
                dialog.on('closed', self, def.resolve.bind(def));
            };
            if (this.nodeOptions.quick_create) {
                var model = this.__parentedParent.$el.find('span.o_field_char')[0].innerText;
                this.trigger_up('mutexify', {
                    action: function () {
                        return self._rpc({
                            model: model,
                            method: 'name_create',
                            args: [name],
                            context: self.record.getContext(self.recordParams),
                        }).then(function (result) {
                            if (self.mode === "edit") {
                                self.reinitialize({id: result[0], display_name: result[1]});
                            }
                            def.resolve();
                        }).fail(function (error, event) {
                            event.preventDefault();
                            slowCreate();
                        });
                    },
                });
            } else {
                slowCreate();
            }
            return def;
        },
        /**
         * @private
         */
        _renderEdit: function () {
            var value = this.m2o_value;

            // this is a stupid hack necessary to support the always_reload flag.
            // the field value has been reread by the basic model.  We use it to
            // display the full address of a patner, separated by \n.  This is
            // really a bad way to do it.  Now, we need to remove the extra lines
            // and hope for the best that noone tries to uses this mechanism to do
            // something else.
            if (this.nodeOptions.always_reload) {
                value = this._getDisplayName(value);
            }
            this.$input.val(value);
            if (!this.autocomplete_bound) {
                this._bindAutoComplete();
            }
            this._updateExternalButton();
        },
        /**
         * @private
         */
        _renderReadonly: function () {
            var value = _.escape((this.m2o_value || "").trim()).split("\n").join("<br/>");
            this.$el.html(value);
            if (!this.nodeOptions.no_open) {
                this.$el.attr('href', '#');
                this.$el.addClass('o_form_uri');
            }
        },
        /**
         * Converts the value from the field to a string representation.
         *
         * @private
         * @param {any} value (from the field type)
         * @returns {string}
         */
        _formatValue: function (value) {
            var self = this;
            if (value.id && !value.display_name){
                var model = this.__parentedParent.$el.find('span.o_field_char')[0].innerText;
                this._rpc({
                        model: model,
                        method: 'read',
                        args: [value.id]
                    }).then(function (result) {
                        var dispay_name = result[0].display_name,
                            text_area = self.$el.find('input.o_input');

                        self.abstract_value.display_name = dispay_name;
                        if (text_area){
                            text_area.val(dispay_name)
                        }
                    });
            } else {
                return value.display_name || '';
            }
        },
        /**
         * @private
         */
        _reset: function (record, event) {
            this._super.apply(this, arguments);

            this.m2o_value = this._formatValue(this.abstract_value);
            this.value = this.abstract_value.id;

        },
        /**
         * this method is called by the widget, to change its value and to notify
         * the outside world of its new state.  This method also validates the new
         * value.  Note that this method does not rerender the widget, it should be
         * handled by the widget itself, if necessary.
         *
         * @private
         * @param {any} value
         * @param {Object} [options]
         * @param {boolean} [options.doNotSetDirty=false] if true, the basic model
         *   will not consider that this field is dirty, even though it was changed.
         *   Please do not use this flag unless you really need it.  Our only use
         *   case is currently the pad widget, which does a _setValue in the
         *   renderEdit method.
         * @param {boolean} [options.notifyChange=true] if false, the basic model
         *   will not notify and not trigger the onchange, even though it was changed.
         * @param {boolean} [options.forceChange=false] if true, the change event will be
         *   triggered even if the new value is the same as the old one
         * @returns {Deferred}
         */
        _setValue: function (value, options) {
            // we try to avoid doing useless work, if the value given has not
            // changed.  Note that we compare the unparsed values.
            this.abstract_value = value;
            if (this.lastSetValue === value || (this.value === false && value === '')) {
                return $.when();
            }
            this.lastSetValue = value;
            try {
                value = value.id;
                // value = this._parseValue(value);
                this._isValid = true;
            } catch (e) {
                this._isValid = false;
                this.trigger_up('set_dirty', {dataPointID: this.dataPointID});
                return $.Deferred().reject();
            }
            if (!(options && options.forceChange) && this._isSameValue(value)) {
                return $.when();
            }
            var def = $.Deferred();
            var changes = {};
            changes[this.name] = value;
            this.trigger_up('field_changed', {
                dataPointID: this.dataPointID,
                changes: changes,
                viewType: this.viewType,
                doNotSetDirty: options && options.doNotSetDirty,
                notifyChange: !options || options.notifyChange !== false,
                onSuccess: def.resolve.bind(def),
                onFailure: def.reject.bind(def),
            });
            return def;
        },
        /**
         * @private
         * @param {string} search_val
         * @returns {Deferred}
         */
        _search: function (search_val) {
            var self = this;
            var def = $.Deferred();
            this.orderer.add(def);

            var context = this.record.getContext(this.recordParams);
            var domain = this.record.getDomain(this.recordParams);

            var blacklisted_ids = this._getSearchBlacklist();
            if (blacklisted_ids.length > 0) {
                domain.push(['id', 'not in', blacklisted_ids]);
            }
            var model = this.__parentedParent.$el.find('span.o_field_char')[0].innerText;
            this._rpc({
                model: model,
                method: "name_search",
                kwargs: {
                    name: search_val,
                    args: domain,
                    operator: "ilike",
                    limit: this.limit + 1,
                    context: context,
                }})
                .then(function (result) {
                    // possible selections for the m2o
                    var values = _.map(result, function (x) {
                        x[1] = self._getDisplayName(x[1]);
                        return {
                            label: _.str.escapeHTML(x[1].trim()) || data.noDisplayContent,
                            value: x[1],
                            name: x[1],
                            id: x[0],
                        };
                    });

                    // search more... if more results than limit
                    if (values.length > self.limit) {
                        values = values.slice(0, self.limit);
                        values.push({
                            label: _t("Search More..."),
                            action: function () {
                                self._rpc({
                                        model: model,
                                        method: 'name_search',
                                        kwargs: {
                                            name: search_val,
                                            args: domain,
                                            operator: "ilike",
                                            limit: 160,
                                            context: context,
                                        },
                                    })
                                    .then(self._searchCreatePopup.bind(self, "search"));
                            },
                            classname: 'o_m2o_dropdown_option',
                        });
                    }
                    var create_enabled = self.can_create && !self.nodeOptions.no_create;
                    // quick create
                    var raw_result = _.map(result, function (x) { return x[1]; });
                    if (create_enabled && !self.nodeOptions.no_quick_create &&
                        search_val.length > 0 && !_.contains(raw_result, search_val)) {
                        values.push({
                            label: _.str.sprintf(_t('Create "<strong>%s</strong>"'),
                                $('<span />').text(search_val).html()),
                            action: self._quickCreate.bind(self, search_val),
                            classname: 'o_m2o_dropdown_option'
                        });
                    }
                    // create and edit ...
                    if (create_enabled && !self.nodeOptions.no_create_edit) {
                        var createAndEditAction = function () {
                            // Clear the value in case the user clicks on discard
                            self.$('input').val('');
                            return self._searchCreatePopup("form", false, self._createContext(search_val));
                        };
                        values.push({
                            label: _t("Create and Edit..."),
                            action: createAndEditAction,
                            classname: 'o_m2o_dropdown_option',
                        });
                    } else if (values.length === 0) {
                        values.push({
                            label: _t("No results to show..."),
                        });
                    }

                    def.resolve(values);
                });

            return def;
        },
        /**
         * all search/create popup handling
         *
         * @private
         * @param {any} view
         * @param {any} ids
         * @param {any} context
         */
        _searchCreatePopup: function (view, ids, context) {
            var self = this;
            var model = self.__parentedParent.$el.find('span.o_field_char')[0].innerText;
            return new dialogs.SelectCreateDialog(this, _.extend({}, this.nodeOptions, {
                res_model: model,
                domain: this.record.getDomain({fieldName: this.name}),
                context: _.extend({}, this.record.getContext(this.recordParams), context || {}),
                title: (view === 'search' ? _t("Search: ") : _t("Create: ")) + this.string,
                initial_ids: ids ? _.map(ids, function (x) { return x[0]; }) : undefined,
                initial_view: view,
                disable_multiple_selection: true,
                on_selected: function (records) {
                    self.reinitialize(records[0]);
                    self.activate();
                }
            })).open();
        },
        /**
         * @private
         */
        _updateExternalButton: function () {
            var has_external_button = !this.nodeOptions.no_open && !this.floating && this.isSet();
            this.$external_button.toggle(has_external_button);
            this.$el.toggleClass('o_with_button', has_external_button); // Should not be required anymore but kept for compatibility
        },


        //--------------------------------------------------------------------------
        // Handlers
        //--------------------------------------------------------------------------

        /**
         * @private
         * @param {MouseEvent} event
         */
        _onClick: function (event) {
            var self = this;
            if (this.mode === 'readonly' && !this.nodeOptions.no_open) {
                event.preventDefault();
                event.stopPropagation();
                var model = this.__parentedParent.$el.find('span.o_field_char')[0].innerText;
                this._rpc({
                        model: model,
                        method: 'get_formview_action',
                        args: [[this.value.res_id]],
                        context: this.record.getContext(this.recordParams),
                    })
                    .then(function (action) {
                        self.trigger_up('do_action', {action: action});
                    });
            }
        },
        /**
         * @private
         */
        _onExternalButtonClick: function () {
            if (!this.value) {
                this.activate();
                return;
            }
            var self = this;
            var context = this.record.getContext(this.recordParams);
            var model = this.__parentedParent.$el.find('span.o_field_char')[0].innerText;
            this._rpc({
                    model: model,
                    method: 'get_formview_id',
                    args: [[this.value.res_id]],
                    context: context,
                })
                .then(function (view_id) {
                    new dialogs.FormViewDialog(self, {
                        res_model: model,
                        res_id: self.value,
                        context: context,
                        title: _t("Open: ") + self.string,
                        view_id: view_id,
                        readonly: !self.can_write,
                        on_saved: function () {
                            var res_model = this.options.res_model
                            var res_id = this.options.res_id
                            self._rpc({
                                model: res_model,
                                method: 'read',
                                args: [res_id]
                            }).then(function (result) {
                                var dispay_name = result[0].display_name,
                                    text_area = self.$el.find('input.o_input');

                                self.abstract_value.display_name = dispay_name;
                                if (text_area){
                                    text_area.val(dispay_name)
                                }
                            });
                        },
                    }).open();
                });
        },
        /**
         * @private
         */
        _onInputClick: function () {
            if (this.$input.autocomplete("widget").is(":visible")) {
                this.$input.autocomplete("close");
            } else if (this.floating) {
                this.$input.autocomplete("search"); // search with the input's content
            } else {
                this.$input.autocomplete("search", ''); // search with the empty string
            }
        },
        /**
         * @private
         */
        _onInputFocusout: function () {
            if (this.can_create && this.floating) {
                new M2ODialog(this, this.string, this.$input.val()).open();
            }
        },
        /**
         * @private
         *
         * @param {OdooEvent} ev
         */
        _onInputKeyup: function (ev) {
            if (ev.which === $.ui.keyCode.ENTER) {
                // If we pressed enter, we want to prevent _onInputFocusout from
                // executing since it would open a M2O dialog to request
                // confirmation that the many2one is not properly set.
                return;
            }
            this.m2o_value = this._formatValue(this.abstract_value);
            if (this.$input.val() === "") {
                this.reinitialize(false);
            } else if (this._getDisplayName(this.m2o_value) !== this.$input.val()) {
                this.floating = true;
                this._updateExternalButton();
            }
        },
        /**
         * @override
         * @private
         */
        _onKeydown: function () {
            this.floating = false;
            this._super.apply(this, arguments);
        },
        /**
         * Stops the left/right navigation move event if the cursor is not at the
         * start/end of the input element. Stops any navigation move event if the
         * user is selecting text.
         *
         * @private
         * @param {OdooEvent} ev
         */
        _onNavigationMove: function (ev) {
            // TODO Maybe this should be done in a mixin or, better, the m2o field
            // should be an InputField (but this requires some refactoring).
            basicFields.InputField.prototype._onNavigationMove.apply(this, arguments);
            if (this.mode === 'edit' && $(this.$input.autocomplete('widget')).is(':visible')) {
                ev.stopPropagation();
            }
        },
        /**
         * @private
         * @param {OdooEvent} event
         */
        _onQuickCreate: function (event) {
            this._quickCreate(event.data.value);
        },
        /**
         * @private
         * @param {OdooEvent} event
         */
        _onSearchCreatePopup: function (event) {
            var data = event.data;
            this._searchCreatePopup(data.view_type, false, this._createContext(data.value));
        },
    });

    fieldRegistry.add('genialSelection', GenialSelection);

});
