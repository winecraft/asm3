/*jslint browser: true, forin: true, eqeq: true, white: true, sloppy: true, vars: true, nomen: true */
/*global $, jQuery, _, asm, common, config, controller, dlgfx, format, edit_header, header, html, tableform, validate */

$(function() {

    var lastanimal = null;
    var lastperson = null;
    var lastretailer = null;
    var movements = {};
    // Filter list of chooseable types
    var choosetypes = [];
    $.each(controller.movementtypes, function(i, v) {
        if (v.ID == 8 && !config.bool("DisableRetailer")) {
            choosetypes.push(v);
        }
        if (v.ID !=8 && v.ID != 9 && v.ID != 10 && v.ID != 11 && v.ID != 12) {
            choosetypes.push(v);
        }
    });

    var dialog = {
        add_title: _("Add movement"),
        edit_title: _("Edit movement"),
        close_on_ok: false,
        autofocus: false,
        columns: 2,
        fields: [
            { json_field: "ANIMALID", post_field: "animal", label: _("Animal"), type: "animal" },
            { json_field: "OWNERID", post_field: "person", label: _("Person"), type: "person" },
            { json_field: "RETAILERID", post_field: "retailer", label: _("Retailer"), type: "person", personfilter: "retailer", hideif: function() { return config.bool("DisableRetailer"); } },
            { json_field: "ADOPTIONNUMBER", post_field: "adoptionno", label: _("Movement Number"), tooltip: _("A unique number to identify this movement"), type: "text" },
            { json_field: "INSURANCENUMBER", post_field: "insurance", label: _("Insurance"), tooltip: _("If the shelter provides initial insurance cover to new adopters, the policy number"), type: "text" },
            { json_field: "RESERVATIONDATE", post_field: "reservationdate", label: _("Reservation Date"), tooltip: _("The date this animal was reserved"), type: "date" },
            { json_field: "RESERVATIONSTATUSID", post_field: "reservationstatus", label: _("Reservation Status"), type: "select", options: { displayfield: "STATUSNAME", valuefield: "ID", rows: controller.reservationstatuses }},
            { json_field: "RESERVATIONCANCELLEDDATE", post_field: "reservationcancelled", label: _("Reservation Cancelled"), type: "date" },
            { type: "nextcol" },
            { json_field: "MOVEMENTTYPE", post_field: "type", label: _("Movement Type"), type: "select", options: { displayfield: "MOVEMENTTYPE", valuefield: "ID", rows: choosetypes }},
            { json_field: "MOVEMENTDATE", post_field: "movementdate", label: _("Movement Date"), type: "date" },
            { json_field: "ISPERMANENTFOSTER", post_field: "permanentfoster", label: _("Permanent Foster"), tooltip: _("Is this a permanent foster?"), type: "check" },
            { json_field: "ISTRIAL", post_field: "trial", label: _("Trial Adoption"), tooltip: _("Is this a trial adoption?"), type: "check" },
            { json_field: "TRIALENDDATE", post_field: "trialenddate", label: _("Trial ends on"), tooltip: _("The date the trial adoption is over"), type: "date" },
            { json_field: "COMMENTS", post_field: "comments", label: _("Comments"), type: "textarea" },
            { json_field: "RETURNDATE", post_field: "returndate", label: _("Return Date"), type: "date" },
            { json_field: "RETURNEDREASONID", post_field: "returncategory", label: _("Return Category"), type: "select", options: { displayfield: "REASONNAME", valuefield: "ID", rows: controller.returncategories}},
            { json_field: "REASONFORRETURN", post_field: "reason", label: _("Reason"), type: "textarea" }
        ]
    };

    var table = {
        rows: controller.rows,
        idcolumn: "ID",
        edit: function(row) {
            tableform.fields_populate_from_json(dialog.fields, row);
            movements.type_change(); 
            movements.returndate_change();
            tableform.dialog_show_edit(dialog, row, function() {
                if (!movements.validation()) { tableform.dialog_enable_buttons(); return; }
                tableform.fields_update_row(dialog.fields, row);
                movements.set_extra_fields(row);
                tableform.fields_post(dialog.fields, "mode=update&movementid=" + row.ID, controller.name, function(response) {
                    tableform.table_update(table);
                    tableform.dialog_close();
                },
                function(response) {
                    tableform.dialog_error(response);
                    tableform.dialog_enable_buttons();
                });
            });
        },
        overdue: function(row) {
            // If this is the reservation book, overdue is determined by reservation being older than a week
            if (controller.name == "move_book_reservation" && row.RESERVATIONDATE) {
                var od = format.date_js(row.RESERVATIONDATE);
                od.setDate(od.getDate() + 7);
                return od < common.today_no_time();
            }
            return false;
        },
        complete: function(row) {
            // If this is the trial book, completion is determined by trial end date passing
            if (row.ISTRIAL == 1 && controller.name == "move_book_trial_adoption" && row.TRIALENDDATE && format.date_js(row.TRIALENDDATE) <= new Date()) {
                return true;
            }
            // Otherwise, it's whether the animal has been returned or is a cancelled reservation
            if (row.RESERVATIONCANCELLEDDATE != null || (row.RETURNDATE != null && format.date_js(row.RETURNDATE) <= new Date())) {
                return true;
            }
        },
        columns: [
            { field: "MOVEMENTNAME", display: _("Type") }, 
            { field: "MOVEMENTDATE", display: _("Date"), 
                initialsort: controller.name != "move_book_trial_adoption", 
                initialsortdirection: controller.name == "move_book_reservation" ? "asc" : "desc", 
                formatter: function(row, v) { 
                    // If we're only a reservation, show that for the date instead
                    if (row.MOVEMENTTYPE == 0) { return format.date(row.RESERVATIONDATE); }
                    return format.date(row.MOVEMENTDATE);
                }
            },
            { field: "RESERVATIONSTATUSNAME", display: _("Status"),
                hideif: function(row) {
                    // Don't show this column if we aren't in the reservation book
                    return controller.name != "move_book_reservation";
                }
            },
            { field: "RETURNDATE", display: controller.name == "move_book_transport" ? _("Arrival") : _("Returned"), formatter: tableform.format_date, 
                hideif: function(row) {
                    // Don't show this column for the trial adoption book
                    if (controller.name == "move_book_trial_adoption") { return true; }
                }
            },
            { field: "TRIALENDDATE", display: _("Trial ends on"), formatter: tableform.format_date,
                initialsort: controller.name == "move_book_trial_adoption",
                initialsortdirection: "desc",
                hideif: function(row) {
                    // Don't show this column if we aren't the trial adoption book
                    if (controller.name != "move_book_trial_adoption") { return true; }
                }
            },
            { field: "SPECIESNAME", display: _("Species"), 
                hideif: function(row) {
                    // Don't show this column for animal movements
                    if (controller.name == "animal_movements") { return true; }
                }
            },
            { field: "IMAGE", display: "", 
                formatter: function(row) {
                    return '<a href="animal?id=' + row.ANIMALID + '"><img src=' + html.thumbnail_src(row, "animalthumb") + ' style="margin-right: 8px" class="asm-thumbnail thumbnailshadow" /></a>';
                },
                hideif: function(row) {
                    // Don't show this column if we aren't a book, or the option is turned off
                    if (controller.name.indexOf("book") == -1 || !config.bool("PicturesInBooks")) {
                        return true;
                    }
                }
            },
            { field: "ANIMAL", display: _("Animal"), 
                formatter: function(row) {
                    var s = "";
                    if (controller.name != "animal_movements") { s = html.animal_emblems(row) + " "; }
                    return s + '<a href="animal?id=' + row.ANIMALID + '">' + row.ANIMALNAME + ' - ' + row.SHELTERCODE + '</a>';
                }
            },
            { field: "PERSON", display: _("Person"),
                formatter: function(row) {
                    if (row.OWNERID) {
                        return edit_header.person_link(row, row.OWNERID);
                    }
                    return "";
                },
                hideif: function(row) {
                    return controller.name == "move_book_transport";
                }
            },
            { field: "RETAILER", display: _("Retailer"),
                formatter: function(row) {
                    if (row.RETAILERID) {
                        return '<a href="person?id=' + row.RETAILERID + '">' + row.RETAILERNAME + '</a>';
                    }
                    return "";
                },
                hideif: function(row) {
                    // Hide if retailer stuff is off or we're in a book that shouldn't show it
                    return config.bool("DisableRetailer") || controller.name == "move_book_transport" || controller.name == "move_book_foster";
                }
            },
            { field: "OWNERADDRESS", display: _("Address"), hideif: function(row) { return controller.name == "move_book_transport"; } },
            { field: "HOMETELEPHONE", display: _("Phone"), hideif: function(row) { return controller.name == "move_book_transport"; },
                formatter: function(row) {
                    return row.HOMETELEPHONE + " " + row.WORKTELEPHONE + " " + row.MOBILETELEPHONE;
                }
            },
            { field: "ADOPTIONNUMBER", display: _("Movement Number") }
        ]
    };

    var buttons = [
        { id: "new", text: _("New Movement"), icon: "new", enabled: "always", perm: "aamv", 
             click: function() { 
                tableform.dialog_show_add(dialog, function() {
                    if (!movements.validation()) { tableform.dialog_enable_buttons(); return; }
                    tableform.fields_post(dialog.fields, "mode=create", controller.name, function(response) {
                        var row = {};
                        row.ID = response;
                        tableform.fields_update_row(dialog.fields, row);
                        movements.set_extra_fields(row);
                        row.ADOPTIONNUMBER = format.padleft(response, 6);
                        controller.rows.push(row);
                        tableform.table_update(table);
                        tableform.dialog_close();
                    }, function() {
                        tableform.dialog_enable_buttons();   
                    });
                }, function() {
                    // Setup the dialog for a new record
                    $("#animal").animalchooser("clear");
                    $("#person").personchooser("clear");
                    $("#retailer").personchooser("clear");
                    if (controller.animal) {
                        $("#animal").animalchooser("loadbyid", controller.animal.ID);
                    }
                    if (controller.person) {
                        $("#person").personchooser("loadbyid", controller.person.ID);
                    }
                    $("#type").select("value", "0");
                    $("#returncategory").select("value", config.str("AFDefaultReturnReason"));
                    $("#reservationstatus").select("value", config.str("AFDefaultReservationStatus"));
                    $("#adoptionno").closest("tr").hide();

                    // Choose an appropriate default type based on our controller
                    if (controller.name == "move_book_foster") { $("#type").select("value", "2"); }
                    if (controller.name == "move_book_recent_adoption") { $("#type").select("value", "1"); }
                    if (controller.name == "move_book_recent_transfer") { $("#type").select("value", "3"); }
                    if (controller.name == "move_book_retailer") { $("#type").select("value", "8"); }
                    if (controller.name == "move_book_trial_adoption") { $("#type").select("value", "1"); }

                    // If we're in a book other than the reservation book, set the movement date to today
                    if (controller.name.indexOf("move_book") == 0 && controller.name != "move_book_reservation") {
                        $("#movementdate").val(format.date(new Date()));
                    }

                    // If we're in the reservation book, create the reserve for today
                    if (controller.name == "move_book_reservation") {
                        $("#reservationdate").val(format.date(new Date()));
                    }

                    tableform.dialog_error();
                    movements.type_change();
                    $("#returndate").val("");
                    movements.returndate_change();
                });
             } 
         },
         { id: "delete", text: _("Delete"), icon: "delete", enabled: "multi", perm: "damv", 
             click: function() { 
                 tableform.delete_dialog(function() {
                     tableform.buttons_default_state(buttons);
                     var ids = tableform.table_ids(table);
                     common.ajax_post(controller.name, "mode=delete&ids=" + ids , function() {
                         tableform.table_remove_selected_from_json(table, controller.rows);
                         tableform.table_update(table);
                     });
                 });
             } 
         },
         { id: "toadoption", text: _("To Adoption"), icon: "person", enabled: "one", perm: "camv",
             tooltip: _("Convert this reservation to an adoption"),
             hideif: function() {
                return controller.name.indexOf("reserv") == -1;
             },
             click: function() { 
                var row = tableform.table_selected_row(table);
                tableform.fields_populate_from_json(dialog.fields, row);
                movements.type_change(); 
                movements.returndate_change();
                tableform.dialog_show_edit(dialog, row, function() {
                    if (!movements.validation()) { tableform.dialog_enable_buttons(); return; }
                    tableform.fields_update_row(dialog.fields, row);
                    movements.set_extra_fields(row);
                    tableform.fields_post(dialog.fields, "mode=update&movementid=" + row.ID, controller.name, function(response) {
                        tableform.table_update(table);
                        tableform.dialog_close();
                    },
                    function(response) {
                        tableform.dialog_error(response);
                        tableform.dialog_enable_buttons();
                    });
                },
                function() {
                    $("#type").select("value", "1");
                    $("#movementdate").val(format.date(new Date()));
                    movements.type_change(); 
                    movements.returndate_change();
                });
             }
         }
    ];

    movements = {

        render: function() {
            var s = "";
            s += tableform.dialog_render(dialog);
            if (controller.name == "animal_movements") {
                s += edit_header.animal_edit_header(controller.animal, "movements", controller.tabcounts);
            }
            else if (controller.name == "person_movements") {
                s += edit_header.person_edit_header(controller.person, "movements", controller.tabcounts);
            }
            else {
                s += html.content_header(document.title);
            }
            s += tableform.buttons_render(buttons);
            s += tableform.table_render(table);
            s += html.content_footer();
            return s;
        },

        bind: function() {

            if (controller.name == "animal_movements" || controller.name == "person_movements") {
                $(".asm-tabbar").asmtabs();
            }

            tableform.dialog_bind(dialog);
            tableform.buttons_bind(buttons);
            tableform.table_bind(table, buttons);

            // Watch for movement type changing
            $("#type").change(movements.type_change);

            // Watch for return date changing
            $("#returndate").change(movements.returndate_change);

            // When we choose a person
            $("#person").personchooser().bind("personchooserchange", function(event, rec) {

                lastperson = rec;
                tableform.dialog_error("");

                // We evaluate warnings in order of importance and drop out once we have one.

                // Is this owner banned?
                if (rec.ISBANNED == 1) {
                     if (config.bool("WarnBannedOwner")) { 
                         tableform.dialog_error(_("This person has been banned from adopting animals.")); 
                         return;
                     }
                }

                // Owner previously under investigation
                if (rec.INVESTIGATION > 0) {
                    tableform.dialog_error(_("This person has been under investigation"));
                    return;
                }

                // Owner part of animal control incident
                if (rec.INCIDENT > 0) {
                    tableform.dialog_error(_("This person has an animal control incident against them"));
                    return;
                }


                // Does this owner live in the same postcode area as the animal's
                // original owner?
                if ( format.postcode_prefix($(".animalchooser-oopostcode").val()) == format.postcode_prefix(rec.OWNERPOSTCODE) ||
                     format.postcode_prefix($(".animalchooser-bipostcode").val()) == format.postcode_prefix(rec.OWNERPOSTCODE) ) {
                    if (config.bool("WarnOOPostcode")) { 
                        tableform.dialog_error(_("This person lives in the same area as the person who brought the animal to the shelter.")); 
                        return;
                    }
                }

                // Is this owner not homechecked?
                if (rec.IDCHECK == 0) {
                    if (config.bool("WarnNoHomeCheck")) { 
                        tableform.dialog_error(_("This person has not passed a homecheck."));
                        return;
                    }
                }
            });

            $("#person").personchooser().bind("personchooserloaded", function(event, rec) { lastperson = rec; });
            $("#person").personchooser().bind("personchooserclear", function(event, rec) { tableform.dialog_error(""); });
            $("#animal").animalchooser().bind("animalchooserchange", function(event, rec) { lastanimal = rec; });
            $("#animal").animalchooser().bind("animalchooserloaded", function(event, rec) { lastanimal = rec; });
            $("#retailer").personchooser().bind("personchooserchange", function(event, rec) { lastretailer = rec; });
            $("#retailer").personchooser().bind("personchooserloaded", function(event, rec) { lastretailer = rec; });

            // Insurance button
            $("#insurance").after('<button id="button-insurance">' + _("Issue a new insurance number for this animal/adoption") + '</button>');
            $("#button-insurance")
                .button({ icons: { primary: "ui-icon-cart" }, text: false })
                .click(function() {
                    common.ajax_post("animal_movements", "mode=insurance", 
                        function(result) { $("#insurance").val(result); }, 
                        function(response) { tableform.dialog_error(response); });
            });
            if (!config.bool("UseAutoInsurance")) { $("#button-insurance").button("disable"); }

            if (config.bool("DontShowInsurance")) {
                $("#insurance").closest("tr").hide();
            }

        },

        validation: function() {
            // Movement needs a reservation date or movement type > 0
            if ($("#type").val() == 0 && $("#reservationdate").val() == "") {
                validate.notblank([ "reservationdate" ]);
                tableform.dialog_error(_("A movement must have a reservation date or type."));
                return false;
            }

            // Movement needs a movement date if movement type != 0
            if ($("#type").val() != 0 && $("#movementdate").val() == "") {
                validate.notblank([ "movementdate" ]);
                tableform.dialog_error(_("This type of movement requires a date."));
                return false;
            }

            // Movement types 4 (escaped), 6 (stolen), 7 (released to wild)
            // don't need a person, but all other movements do
            if ($("#person").val() == "") {
                var mt = $("#type").val();
                if (mt != 4 && mt != 6 && mt != 7) {
                    tableform.dialog_error(_("This type of movement requires a person."));
                    $("label[for='person']").addClass("ui-state-error-text");
                    $("#person").focus();
                    return false;
                }
            }

            // All movements require an animal
            if ($("#animal").val() == "") {
                tableform.dialog_error(_("Movements require an animal"));
                $("label[for='animal']").addClass("ui-state-error-text");
                $("#animal").focus();
                return false;
            }

            return true;
        },

        /**
         * Sets extra json fields according to what the user has picked. Call
         * this after updating a json row for entered fields to get the
         * extra lookup fields.
         */
        set_extra_fields: function(row) {
            row.ANIMALNAME = lastanimal.ANIMALNAME;
            row.SHELTERCODE = lastanimal.SHELTERCODE;
            if (lastperson) {
                row.OWNERNAME = lastperson.OWNERNAME;
                row.OWNERADDRESS = lastperson.OWNERADDRESS;
                row.HOMETELEPHONE = lastperson.HOMETELEPHONE;
                row.WORKTELEPHONE = lastperson.WORKTELEPHONE;
                row.MOBILETELEPHONE = lastperson.MOBILETELEPHONE;
            }
            else {
                row.OWNERNAME = ""; row.OWNERADDRESS = "";
                row.HOMETELEPHONE = ""; row.WORKTELEPHONE = "";
                row.MOBILETELEPHONE = "";
            }
            if (lastretailer) {
                row.RETAILERNAME = lastretailer.OWNERNAME;
            }
            else {
                row.RETAILERNAME = "";
            }
            row.AGEGROUP = lastanimal.AGEGROUP;
            row.SEX = lastanimal.SEXNAME;
            row.SPECIESNAME = lastanimal.SPECIESNAME;
            row.MOVEMENTNAME = common.get_field(controller.movementtypes, row.MOVEMENTTYPE, "MOVEMENTTYPE");
            row.RESERVATIONSTATUSNAME = common.get_field(controller.reservationstatuses, row.RESERVATIONSTATUSID, "STATUSNAME");
            if (row.RESERVATIONDATE != null && row.RESERVATIONCANCELLEDDATE == null && !row.MOVEMENTDATE) { row.MOVEMENTNAME = common.get_field(controller.movementtypes, 9, "MOVEMENTTYPE"); }
            if (row.RESERVATIONDATE != null && row.RESERVATIONCANCELLEDDATE != null && !row.MOVEMENTDATE) { row.MOVEMENTNAME = common.get_field(controller.movementtypes, 10, "MOVEMENTTYPE"); }
        },

        /** Fires whenever the movement type box is changed */
        type_change: function() {
            var mt = $("#type").val();
            // Show trial fields if option is set and the movement is an adoption
            $("#trial").closest("tr").hide();
            $("#trialenddate").closest("tr").hide();
            if (config.bool("TrialAdoptions") && mt == 1) {
                $("#trial").closest("tr").fadeIn();
                $("#trialenddate").closest("tr").fadeIn();
            }
            else {
                $("#trial").closest("tr").hide();
                $("#trialenddate").closest("tr").hide();
            }
            // Show permanent field if the movement is a foster
            if (mt == 2) {
                $("#permanentfoster").closest("tr").fadeIn();
            }
            else {
                $("#permanentfoster").closest("tr").hide();
            }
            // If the movement isn't an adoption, hide the retailer row
            if (mt == 1 && !config.bool("DisableRetailer")) {
                $("#retailer").closest("tr").fadeIn();
            }
            else {
                $("#retailer").closest("tr").hide();
            }
            // Show the insurance row for adoptions
            if (mt == 1) {
                $("#insurance").closest("tr").fadeIn();
            }
            else {
                $("#insurance").closest("tr").fadeOut();
            }
            // Show the reservation fields for reserves
            if (mt == 0) {
                $("#reservationdate").closest("tr").fadeIn();
                $("#reservationstatus").closest("tr").fadeIn();
                $("#reservationcancelled").closest("tr").fadeIn();
            }
            else {
                $("#reservationdate").closest("tr").fadeOut();
                $("#reservationstatus").closest("tr").fadeOut();
                $("#reservationcancelled").closest("tr").fadeOut();
            }
            // If the movement is one that doesn't require a person, hide the person row
            if (mt == 4 || mt == 6 || mt == 7) {
                $("#person").closest("tr").fadeOut();
            }
            else {
                $("#person").closest("tr").fadeIn();
            }
        },

        /** Fires when the return date is changed */
        returndate_change: function() {
            // Show return category/reason for movements that need them 
            // (fosters do not)
            if ($("#returndate").val() && $("#type").val() != 2) {
                $("#returncategory").closest("tr").fadeIn();
                $("#reason").closest("tr").fadeIn();
            }
            else {
                $("#returncategory").closest("tr").fadeOut();
                $("#reason").closest("tr").fadeOut();
            }
        }
    };

    common.module(movements, "movements", common.current_url().indexOf("book") != -1 ? "book" : "formtab");

});
