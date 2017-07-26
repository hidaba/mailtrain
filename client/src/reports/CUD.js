'use strict';

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { translate, Trans } from 'react-i18next';
import { requiresAuthenticatedUser, withPageHelpers, Title } from '../lib/page';
import {
    withForm, Form, FormSendMethod, InputField, TextArea, TableSelect, TableSelectMode, ButtonRow, Button,
    Fieldset
} from '../lib/form';
import axios from '../lib/axios';
import { withErrorHandling, withAsyncErrorHandler } from '../lib/error-handling';
import { ModalDialog } from '../lib/bootstrap-components';
import moment from 'moment';
import { validateNamespace, NamespaceSelect } from '../lib/namespace';

@translate()
@withForm
@withPageHelpers
@withErrorHandling
@requiresAuthenticatedUser
export default class CUD extends Component {
    constructor(props) {
        super(props);

        this.state = {};

        if (props.edit) {
            this.state.entityId = parseInt(props.match.params.id);
        }

        this.initForm({
            onChange: {
                report_template: ::this.onReportTemplateChange
            }
        });
    }

    static propTypes = {
        edit: PropTypes.bool
    }

    isDelete() {
        return this.props.match.params.action === 'delete';
    }

    @withAsyncErrorHandler
    async fetchUserFields(reportTemplateId) {
        const result = await axios.get(`/rest/report-template-user-fields/${reportTemplateId}`);
        this.updateFormValue('user_fields', result.data);
    }

    onReportTemplateChange(state, key, oldVal, newVal) {
        if (oldVal !== newVal) {
            state.formState = state.formState.setIn(['data', 'user_fields', 'value'], '');

            if (newVal) {
                this.fetchUserFields(newVal);
            }
        }
    }

    @withAsyncErrorHandler
    async loadFormValues() {
        await this.getFormValuesFromURL(`/rest/reports/${this.state.entityId}`, data => {
            for (const key in data.params) {
                data[`param_${key}`] = data.params[key];
            }
        });
    }

    componentDidMount() {
        if (this.props.edit) {
            this.loadFormValues();
        } else {
            this.populateFormValues({
                name: '',
                description: '',
                report_template: null,
                namespace: null,
                user_fields: null
            });
        }
    }

    localValidateFormValues(state) {
        const t = this.props.t;
        const edit = this.props.edit;

        if (!state.getIn(['name', 'value'])) {
            state.setIn(['name', 'error'], t('Name must not be empty'));
        } else {
            state.setIn(['name', 'error'], null);
        }

        if (!state.getIn(['report_template', 'value'])) {
            state.setIn(['report_template', 'error'], t('Report template must be selected'));
        } else {
            state.setIn(['report_template', 'error'], null);
        }

        for (const paramId of state.keys()) {
            if (paramId.startsWith('param_')) {
                state.deleteIn([paramId, 'error']);
            }
        }

        const userFieldsSpec = state.getIn(['user_fields', 'value']);
        if (userFieldsSpec) {
            for (const spec of userFieldsSpec) {
                const fldId = `param_${spec.id}`;
                const selection = state.getIn([fldId, 'value']) || [];

                if (spec.maxOccurences === 1) {
                    if (spec.minOccurences === 1 && (selection === null || selection === undefined)) {
                        state.setIn([fldId, 'error'], t('Exactly one item has to be selected'));
                    }
                } else {
                    if (selection.length < spec.minOccurences) {
                        state.setIn([fldId, 'error'], t('At least {{ count }} item(s) have to be selected', { count: spec.minOccurences }));
                    } else if (selection.length > spec.maxOccurences) {
                        state.setIn([fldId, 'error'], t('At most {{ count }} item(s) can to be selected', { count: spec.maxOccurences }));
                    }
                }
            }
        }

        validateNamespace(t, state);
    }

    async submitHandler() {
        const t = this.props.t;
        const edit = this.props.edit;

        if (!this.getFormValue('user_fields')) {
            this.setFormStatusMessage('warning', t('Report parameters are not selected. Wait for them to get displayed and then fill them in.'));
            return;
        }

        let sendMethod, url;
        if (edit) {
            sendMethod = FormSendMethod.PUT;
            url = `/rest/reports/${this.state.entityId}`
        } else {
            sendMethod = FormSendMethod.POST;
            url = '/rest/reports'
        }

        this.disableForm();
        this.setFormStatusMessage('info', t('Saving report template ...'));

        const submitSuccessful = await this.validateAndSendFormValuesToURL(sendMethod, url, data => {
            const params = {};

            for (const spec of data.user_fields) {
                const fldId = `param_${spec.id}`;
                params[spec.id] = data[fldId];
                delete data[fldId];
            }

            delete data.user_fields;
            data.params = params;
        });

        if (submitSuccessful) {
            this.navigateToWithFlashMessage('/reports', 'success', t('Report saved'));
        } else {
            this.enableForm();
            this.setFormStatusMessage('warning', t('There are errors in the form. Please fix them and submit again.'));
        }
    }

    async showDeleteModal() {
        this.navigateTo(`/reports/edit/${this.state.entityId}/delete`);
    }

    async hideDeleteModal() {
        this.navigateTo(`/reports/edit/${this.state.entityId}`);
    }

    async performDelete() {
        const t = this.props.t;

        await this.hideDeleteModal();

        this.disableForm();
        this.setFormStatusMessage('info', t('Deleting report...'));

        await axios.delete(`/rest/reports/${this.state.entityId}`);

        this.navigateToWithFlashMessage('/reports', 'success', t('Report deleted'));
    }

    render() {
        const t = this.props.t;
        const edit = this.props.edit;

        const reportTemplateColumns = [
            { data: 0, title: "#" },
            { data: 1, title: t('Name') },
            { data: 2, title: t('Description') },
            { data: 3, title: t('Created'), render: data => moment(data).fromNow() }
        ];

        const userFieldsSpec = this.getFormValue('user_fields');
        const userFields = [];

        function addUserFieldTableSelect(spec, dataUrl, selIndex, columns) {
            let dropdown, selectMode;

            if (spec.maxOccurences === 1) {
                dropdown = true;
                selectMode = TableSelectMode.SINGLE;
            } else {
                dropdown = true;
                selectMode = TableSelectMode.MULTI;
            }

            const fld = <TableSelect key={spec.id} id={`param_${spec.id}`} label={spec.name} selectionAsArray withHeader dropdown={dropdown} selectMode={selectMode} dataUrl={dataUrl} columns={columns} selectionLabelIndex={selIndex}/>;

            userFields.push(fld);
        }

        if (userFieldsSpec) {
            for (const spec of userFieldsSpec) {
                if (spec.type === 'campaign') {
                    addUserFieldTableSelect(spec, '/rest/campaigns-table', 1,[
                        {data: 0, title: "#"},
                        {data: 1, title: t('Name')},
                        {data: 2, title: t('Description')},
                        {data: 3, title: t('Status')},
                        {data: 4, title: t('Created'), render: data => moment(data).fromNow()}
                    ]);
                } else if (spec.type === 'list') {
                    addUserFieldTableSelect(spec, '/rest/lists-table', 1,[
                        {data: 0, title: "#"},
                        {data: 1, title: t('Name')},
                        {data: 2, title: t('ID')},
                        {data: 3, title: t('Subscribers')},
                        {data: 4, title: t('Description')}
                    ]);
                } else {
                    userFields.push(<div className="alert alert-danger" role="alert">{t('Unknown field type "{{type}}"', { type: spec.type })}</div>)
                }
            }
        }

        // FIXME - filter namespaces by permission

        return (
            <div>
                {edit &&
                    <ModalDialog hidden={!this.isDelete()} title={t('Confirm deletion')} onCloseAsync={::this.hideDeleteModal} buttons={[
                        { label: t('No'), className: 'btn-primary', onClickAsync: ::this.hideDeleteModal },
                        { label: t('Yes'), className: 'btn-danger', onClickAsync: ::this.performDelete }
                    ]}>
                        {t('Are you sure you want to delete "{{name}}"?', {name: this.getFormValue('name')})}
                    </ModalDialog>
                }

                <Title>{edit ? t('Edit Report') : t('Create Report')}</Title>

                <Form stateOwner={this} onSubmitAsync={::this.submitHandler}>
                    <InputField id="name" label={t('Name')}/>
                    <TextArea id="description" label={t('Description')} help={t('HTML is allowed')}/>

                    <TableSelect id="report_template" label={t('Report Template')} withHeader dropdown dataUrl="/rest/report-templates-table" columns={reportTemplateColumns} selectionLabelIndex={1}/>

                    <NamespaceSelect/>

                    {userFieldsSpec ?
                        userFields.length > 0 &&
                            <Fieldset label={t('Report parameters')}>
                                {userFields}
                            </Fieldset>
                    :
                        this.getFormValue('report_template') &&
                            <div className="alert alert-info" role="alert">{t('Loading report template...')}</div>
                    }

                    <ButtonRow>
                        <Button type="submit" className="btn-primary" icon="ok" label={t('Save')}/>
                        {edit && <Button className="btn-danger" icon="remove" label={t('Delete Report')} onClickAsync={::this.showDeleteModal}/>}
                    </ButtonRow>
                </Form>
            </div>
        );
    }
}