import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { Button } from '@mui/material';
import { useEffect, useState } from 'react';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select, { SelectChangeEvent } from '@mui/material/Select';
import axios from 'axios';


const EditPopup = (props) => {

    const { open, handleClose, data, addNew, title } = props;
    const [updatedConnection, setUpdatedConnection] = useState(props.data);

    useEffect(() => {
        setUpdatedConnection(data);
    }, [data])

    const saveConnection = async () => {
        console.log('want to save connection -- > ', updatedConnection);
        const url = `http://localhost:3003/api/connections/${updatedConnection._id}`;
        await axios
        .put(url, updatedConnection)
        .then(async function (response: any) {
            if (response.status === 200) {
                console.log('Success - Updated connection ');
                handleClose();
            }
        })
        .catch((error: any) => {
            console.log('Error deleteing connection -- > ', error);
        });
    }

    const createConnection = async () => {
        console.log('want to create connection -- > ', updatedConnection);
        const url = 'http://localhost:3003/api/connections';
        await axios
        .post(url, updatedConnection)
        .then(function (response: { status: any }) {
            if (response.status === 200) {
                console.log('Success - created client');
                handleClose();
            }
        })
        .catch((error: any) => {
            console.log('Error registering client-- > ', error);
        });
    }

    const cancelConnectionEdit = () => {
        setUpdatedConnection(props.data);
        handleClose();
    }

    const fieldsFilled = () => {
        return (updatedConnection?.code && updatedConnection?.system 
            && updatedConnection?.to && updatedConnection?.toEtasu);
    }

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth={true}
            maxWidth='md'
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
        >
            <DialogTitle id="alert-dialog-title" className='popup-title'>{title}</DialogTitle>
            <DialogContent style={{paddingTop: '15px', borderBottom: '1px solid #F1F3F4'}}>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description">
                        Code:
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="code"
                        name="code"
                        type="string"
                        value={updatedConnection?.code}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, code: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description">
                        System:
                    </DialogContentText>
                    <FormControl fullWidth>
                        <InputLabel id="demo-simple-select-label">Select a system</InputLabel>
                        <Select
                            labelId="demo-simple-select-label"
                            id="demo-simple-select"
                            size="small"
                            value={updatedConnection?.system}
                            onChange={(event: SelectChangeEvent) => {
                                setUpdatedConnection((prevState: any) => ({...prevState, system: event.target.value}));
                            }}
                            >
                                <MenuItem value={"http://hl7.org/fhir/sid/ndc"}>NDC</MenuItem>
                                <MenuItem value={"http://www.nlm.nih.gov/research/umls/rxnorm"}>RXNorm</MenuItem>
                                <MenuItem value={"http://snomed.info/sct"}>SNOMED</MenuItem>
                        </Select>
                    </FormControl>
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description" style={{width: '145px'}}>
                        REMS Endpoint:
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="to"
                        name="to"
                        type="string"
                        value={updatedConnection?.to}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, to: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description" style={{width: '220px'}}>
                        REMS Etasu Endpoint:
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="toEtasu"
                        name="toEtasu"
                        type="string"
                        value={updatedConnection?.toEtasu}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, toEtasu: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description" style={{width: '140px'}}>
                        From (optional):
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="from"
                        name="from"
                        type="string"
                        value={updatedConnection?.from}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, from: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
            </DialogContent>
            <DialogActions>
                <Button onClick={cancelConnectionEdit} variant='outlined' sx={{borderColor: '#53508E', color: '#53508E'}}>Cancel</Button>
                { addNew ? 
                    <Button onClick={createConnection} autoFocus variant='outlined' sx={{borderColor: '#53508E', color: '#53508E'}} disabled={!fieldsFilled()}>
                        Create
                    </Button>
                : 
                    <Button onClick={saveConnection} variant='outlined' sx={{borderColor: '#53508E', color: '#53508E'}} autoFocus>
                        Save
                    </Button>
                }
            </DialogActions>
      </Dialog>
    )
};

export default EditPopup;